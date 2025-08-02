import express from 'express';
import { SquareClient, SquareEnvironment } from "square";
import { randomUUID } from 'crypto';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dns from 'dns';
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

    // --- Ensure upload directory exists ---
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // --- Database Setup ---
    const defaultData = { orders: [], users: {}, credentials: {} };
    const db = await JSONFilePreset(path.join(__dirname, 'db.json'), defaultData);
    console.log('[SERVER] LowDB database initialized.');

    // --- Multer Configuration for File Uploads ---
    const storage = multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, uploadDir);
      },
      filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
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
    const squareClient = new SquareClient({
      version: '2025-07-16',
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment: SquareEnvironment.Sandbox,
    });
    console.log('[SERVER] Verifying connection to Square servers...');
    try {
        await new Promise((resolve, reject) => {
            dns.lookup('connect.squareup.com', (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
        console.log('✅ [SERVER] DNS resolution successful. Network connection appears to be working.');
    } catch (error) {
        console.error('❌ [FATAL] Could not resolve Square API domain.');
        console.error('   This is likely a network, DNS, or firewall issue on the server.');
        console.error('   Full Error:', error.message);
        process.exit(1);
    }
    console.log('[SERVER] Square client initialized.');
  // --- NEW: Local Sanity Check for API properties ---
    console.log('[SERVER] Performing sanity check on Square client...');
    if (!squareClient.locations || !squareClient.payments) {
        console.error('❌ [FATAL] Square client is missing required API properties (locationsApi, paymentsApi).');
        console.error('   This may indicate an issue with the installed Square SDK package.');
        process.exit(1);
    }
    console.log('✅ [SERVER] Sanity check passed. Client has required API properties.');

   

    // --- Middleware ---
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
    });
    
    const allowedOrigins = [
      'https://lokimetasmith.github.io',
    ];
    
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.push(/http:\/\/localhost:\d+/);
    }
    
    const corsOptions = {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.some(allowedOrigin => {
          if (typeof allowedOrigin === 'string') {
            return allowedOrigin === origin;
          }
          if (allowedOrigin instanceof RegExp) {
            return allowedOrigin.test(origin);
          }
          return false;
        });
        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      optionsSuccessStatus: 200,
    };
    
    app.use(limiter);
    app.use(cors(corsOptions));
    app.use(express.json());
    app.use(cookieParser());
    app.use(csrf({ cookie: true }));
    app.use('/uploads', express.static(uploadDir));
    console.log('[SERVER] Middleware (CORS, JSON, static file serving) enabled.');

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
    app.get('/api/ping', (req, res) => {
      res.status(200).json({
        status: 'ok',
        message: 'Server is running',
        timestamp: new Date().toISOString(),
      });
    });
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
      try {
        const { sourceId, amountCents, currency, ...orderDetails } = req.body;
        const paymentPayload = {
          sourceId: sourceId,
          idempotencyKey: randomUUID(),
          locationId: process.env.SQUARE_LOCATION_ID,
          amountMoney: {
            amount: BigInt(amountCents),
            currency: currency || 'USD',
          },
        };
        console.log('[CLIENT INSPECTION] Keys on squareClient:', Object.keys(squareClient));
        const { result: paymentResult, statusCode } = await squareClient.payments.create(paymentPayload);
        if (statusCode >= 300 || (paymentResult.errors && paymentResult.errors.length > 0)) {
          console.error('[SERVER] Square API returned an error:', JSON.stringify(paymentResult.errors));
          return res.status(statusCode || 400).json({ error: 'Square API Error', details: paymentResult.errors });
        }
        console.log('[SERVER] Square payment successful. Payment ID:', paymentResult.payment.id);
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
        console.log(`[SERVER] New order created and stored. Order ID: ${newOrder.orderId}.`);
        return res.status(201).json({ success: true, order: newOrder });
      } catch (error) {
        console.error('[SERVER] Critical error in /api/create-order:', error);
        if (error.response && error.response.data) {
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
      console.log(`[SERVER] Order ID ${orderId} status updated to ${status}.`);
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
    
    app.post('/api/auth/issue-temp-token', [
      body('email').isEmail().withMessage('A valid email is required'),
    ], (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email } = req.body;

      // Create a short-lived token for the purpose of placing one order
      const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '5m' });

      console.log(`[SERVER] Issued temporary token for email: ${email}`);
      res.json({ success: true, token });
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
      console.log(`[SERVER] Uploads will be saved to: ${uploadDir}`);
      console.log(`[SERVER] Static files served from /uploads`);
      console.log(`[SERVER] Square client was initialized using environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox (default)'}`);
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ [FATAL] Port ${port} is already in use.`);
        console.error('Please close the other process or specify a different port in your .env file.');
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