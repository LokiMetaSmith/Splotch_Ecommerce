import express from 'express';
import { Client, Environment } from 'square';
import { randomUUID } from 'crypto';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import { JSONFilePreset } from 'lowdb/node';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Define an async function to contain all server logic
async function startServer() {
  try {
    const app = express();
    const port = process.env.PORT || 3000;
    let locationId; // This will hold the primary location ID for transactions

    // --- Ensure upload directory exists ---
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // --- Database Setup ---
    const db = await JSONFilePreset(path.join(__dirname, 'db.json'), { orders: [], users: {}, credentials: {} });
    console.log('[SERVER] LowDB database initialized.');

    // --- Multer Configuration for File Uploads ---
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadDir),
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
      }
    });
    const upload = multer({ storage: storage });
    console.log('[SERVER] Multer configured for file uploads.');
    
    // --- Square Client Initialization ---
    console.log('[SERVER] Initializing Square client...');
    if (!process.env.SQUARE_ACCESS_TOKEN) {
      console.error('[SERVER] FATAL: SQUARE_ACCESS_TOKEN is not set in environment variables.');
      process.exit(1);
    }
    const squareClient = new Client({
      squareVersion: '2025-07-16',
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
    });
    
    // --- Verify Square API Connection & Get Location ID ---
    console.log('[SERVER] Verifying Square API connection...');
    try {
      const { result } = await squareClient.locationsApi.listLocations();
      if (result.locations && result.locations.length > 0) {
        locationId = result.locations[0].id;
        console.log(`✅ [SERVER] Square API connection successful. Using location: ${locationId}`);
      } else {
        console.warn('⚠️ [SERVER] API connection successful, but no locations were found.');
        locationId = process.env.SQUARE_LOCATION_ID;
        if (locationId) {
            console.log(`[SERVER] Falling back to location ID from .env file: ${locationId}`);
        } else {
            console.error('❌ [FATAL] No locations found and SQUARE_LOCATION_ID is not set in .env file. Payment processing will fail.');
        }
      }
    } catch (error) {
      console.error('❌ [FATAL] Square API call failed. Please check your access token and network connection.');
      if (error.response) {
        console.error('   API Error:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('   Full Error:', error);
      }
      process.exit(1);
    }

    // --- Middleware ---
    const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
    const allowedOrigins = ['https://lokimetasmith.github.io'];
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.push(/http:\/\/localhost:\d+/);
    }
    const corsOptions = {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.some(pattern => new RegExp(pattern).test(origin))) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    };
    
    app.use(limiter);
    app.use(cors(corsOptions));
    app.use(express.json());
    app.use(cookieParser());
    app.use(csrf({ cookie: true }));
    app.use('/uploads', express.static(uploadDir));
    console.log('[SERVER] Middleware enabled.');

    // --- Helper Functions ---
    function authenticateToken(req, res, next) {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (token == null) return res.sendStatus(401);
      jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
      });
    }

    // --- API Endpoints ---
    app.get('/api/csrf-token', (req, res) => {
      res.json({ csrfToken: req.csrfToken() });
    });

    app.post('/api/upload-image', upload.single('image'), (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }
      res.json({ success: true, filePath: `/uploads/${req.file.filename}` });
    });

    // --- Order Endpoints ---
    app.post('/api/create-order', authenticateToken, upload.single('designImage'), [
      body('sourceId').notEmpty().withMessage('sourceId is required'),
      body('amountCents').isInt({ gt: 0 }).withMessage('amountCents must be a positive integer'),
      body('currency').optional().isAlpha().withMessage('currency must be alphabetic'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      if (!locationId) {
        return res.status(500).json({ error: "Server is misconfigured: Location ID is not available for payments." });
      }
      try {
        const { sourceId, amountCents, currency, ...orderDetails } = req.body;
        const paymentPayload = {
          sourceId: sourceId,
          idempotencyKey: randomUUID(),
          locationId: locationId,
          amountMoney: {
            amount: BigInt(amountCents),
            currency: currency || 'USD',
          },
        };
        const { result: paymentResult, statusCode } = await squareClient.paymentsApi.createPayment(paymentPayload);
        if (statusCode >= 300 || (paymentResult.errors && paymentResult.errors.length > 0)) {
          return res.status(statusCode || 400).json({ error: 'Square API Error', details: paymentResult.errors });
        }
        const newOrder = {
          orderId: randomUUID(),
          paymentId: paymentResult.payment.id,
          squareOrderId: paymentResult.payment.orderId,
          amount: Number(amountCents),
          currency: currency || 'USD',
          status: 'NEW',
          orderDetails: JSON.parse(orderDetails.orderDetails),
          billingContact: JSON.parse(orderDetails.billingContact),
          designImagePath: `/uploads/${req.file.filename}`,
          receivedAt: new Date().toISOString(),
        };
        db.data.orders.push(newOrder);
        await db.write();
        return res.status(201).json({ success: true, order: newOrder });
      } catch (error) {
        console.error('[SERVER] Critical error in /api/create-order:', error);
        if (error.response) {
          return res.status(error.statusCode || 500).json({ error: 'Square API Error', details: error.response.data.errors });
        }
        return res.status(500).json({ error: 'Internal Server Error', message: error.message });
      }
    });
    
    app.get('/api/orders', authenticateToken, (req, res) => {
      const user = Object.values(db.data.users).find(u => u.email === req.user.email);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      const userOrders = db.data.orders.filter(order => order.billingContact.email === user.email);
      res.status(200).json(userOrders.slice().reverse());
    });

    app.get('/api/orders/:orderId', authenticateToken, (req, res) => {
      const { orderId } = req.params;
      const order = db.data.orders.find(o => o.orderId === orderId);
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json(order);
    });

    app.post('/api/orders/:orderId/status', authenticateToken, [
      body('status').notEmpty().withMessage('status is required'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { orderId } = req.params;
      const { status } = req.body;
      const order = db.data.orders.find(o => o.orderId === orderId);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      order.status = status;
      order.lastUpdatedAt = new Date().toISOString();
      await db.write();
      res.status(200).json({ success: true, order: order });
    });

    // --- Auth Endpoints ---
    app.post('/api/auth/register-user', [
      body('username').notEmpty().withMessage('username is required'),
      body('password').notEmpty().withMessage('password is required'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { username, password } = req.body;
      if (db.data.users[username]) {
        return res.status(400).json({ error: 'User already exists' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = {
        id: randomUUID(),
        username,
        password: hashedPassword,
        credentials: [],
      };
      db.data.users[username] = user;
      await db.write();
      res.json({ success: true });
    });

    app.post('/api/auth/login', [
      body('username').notEmpty().withMessage('username is required'),
      body('password').notEmpty().withMessage('password is required'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { username, password } = req.body;
      const user = db.data.users[username];
      if (!user) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
    });
    
    app.post('/api/auth/magic-login', [
      body('email').isEmail().withMessage('email is not valid'),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { email } = req.body;
        let user = Object.values(db.data.users).find(u => u.email === email);
        if (!user) {
            user = {
                id: randomUUID(),
                email,
                credentials: [],
            };
            db.data.users[user.id] = user;
            await db.write();
        }
        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '15m' });
        const magicLink = `${process.env.BASE_URL}/magic-login?token=${token}`;
        console.log('Magic Link (for testing):', magicLink);
        res.json({ success: true, message: 'Check your email for a magic link to log in.' });
    });
    
    app.post('/api/auth/verify-magic-link', (req, res) => {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'No token provided' });
      }
      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        const user = Object.values(db.data.users).find(u => u.email === decoded.email);
        if (!user) {
          return res.status(401).json({ error: 'User not found' });
        }
        const authToken = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ success: true, token: authToken });
      });
    });

    // --- WebAuthn (Passkey) Endpoints ---
    app.get('/api/auth/register-options', (req, res) => {
      const { username } = req.query;
      if (!username || !db.data.users[username]) {
        return res.status(400).json({ error: 'User not found' });
      }
      const options = generateRegistrationOptions({
        rpID: process.env.RP_ID,
        rpName: 'Splotch',
        userName: username,
        authenticatorSelection: {
          userVerification: 'preferred',
        },
      });
      db.data.users[username].challenge = options.challenge;
      db.write();
      res.json(options);
    });

    app.post('/api/auth/register-verify', async (req, res) => {
      const { body } = req;
      const { username } = req.query;
      const user = db.data.users[username];
      try {
        const verification = await verifyRegistrationResponse({
          response: body,
          expectedChallenge: user.challenge,
          expectedOrigin: process.env.EXPECTED_ORIGIN,
          expectedRPID: process.env.RP_ID,
        });
        const { verified, registrationInfo } = verification;
        if (verified) {
          user.credentials.push(registrationInfo);
          db.data.credentials[registrationInfo.credentialID] = registrationInfo;
          await db.write();
        }
        res.json({ verified });
      } catch (error) {
        console.error(error);
        res.status(400).json({ error: error.message });
      }
    });

    app.get('/api/auth/login-options', (req, res) => {
      const { username } = req.query;
      const user = db.data.users[username];
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }
      const options = generateAuthenticationOptions({
        allowCredentials: user.credentials.map(cred => ({
          id: cred.credentialID,
          type: 'public-key',
        })),
        userVerification: 'preferred',
      });
      user.challenge = options.challenge;
      db.write();
      res.json(options);
    });

    app.post('/api/auth/login-verify', async (req, res) => {
      const { body } = req;
      const { username } = req.query;
      const user = db.data.users[username];
      const credential = db.data.credentials[body.id];
      if (!credential) {
        return res.status(400).json({ error: 'Credential not found.' });
      }
      try {
        const verification = await verifyAuthenticationResponse({
          response: body,
          expectedChallenge: user.challenge,
          expectedOrigin: process.env.EXPECTED_ORIGIN,
          expectedRPID: process.env.RP_ID,
          authenticator: credential,
        });
        const { verified } = verification;
        if (verified) {
          const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
          res.json({ verified, token });
        } else {
          res.json({ verified });
        }
      } catch (error) {
        console.error(error);
        res.status(400).json({ error: error.message });
      }
    });

    // --- Start Server ---
    const server = app.listen(port, () => {
      console.log(`[SERVER] Server listening at http://localhost:${port}`);
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ [FATAL] Port ${port} is already in use.`);
        process.exit(1);
      } else {
        console.error(`❌ [FATAL] An unexpected error occurred:`, error);
        process.exit(1);
      }
    });
    
  } catch (error) {
    console.error('[FATAL] Failed to start server:', error);
    process.exit(1);
  }
}

startServer();