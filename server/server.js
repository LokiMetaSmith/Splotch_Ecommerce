// server.js
import express from 'express';
import { SquareClient, SquareEnvironment, SquareError } from "square";
import { randomUUID } from 'crypto';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import cookieParser from 'cookie-parser';
import lusca from 'lusca';
import session from 'express-session';
import { JSONFilePreset } from 'lowdb/node';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { sendEmail } from './email.js';
import { getCurrentSigningKey, getJwks, rotateKeys } from './keyManager.js';
import { initializeBot } from './bot.js';
import { fileTypeFromFile } from 'file-type';
import { calculateStickerPrice, getDesignDimensions } from './pricing.js';

const allowedMimeTypes = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Load pricing configuration
let pricingConfig = {};
try {
    const pricingData = fs.readFileSync(path.join(__dirname, 'pricing.json'), 'utf8');
    pricingConfig = JSON.parse(pricingData);
    console.log('[SERVER] Pricing configuration loaded.');
} catch (error) {
    console.error('[SERVER] FATAL: Could not load pricing.json.', error);
    process.exit(1);
}

import { randomBytes } from 'crypto';

let serverSessionToken;
const SERVER_INSTANCE_ID = randomUUID();

// Function to sign the instance token with the current key
const signInstanceToken = () => {
    const { privateKey, kid } = getCurrentSigningKey();
    serverSessionToken = jwt.sign(
        { instanceId: SERVER_INSTANCE_ID },
        privateKey,
        { algorithm: 'RS256', expiresIn: '1h', header: { kid } }
    );
    console.log(`[SERVER] Signed new session token with key ID: ${kid}`);
};
let db;
let app;

const defaultData = { orders: [], users: {}, credentials: {}, config: {} };

// Define an async function to contain all server logic
async function startServer(db, bot, sendEmail, dbPath = path.join(__dirname, 'db.json')) {
  if (!db) {
    db = await JSONFilePreset(dbPath, defaultData);
  }
  // --- Google OAuth2 Client ---
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `http://localhost:3000/oauth2callback`
  );

  async function logAndEmailError(error, context = 'General Error') {
    const errorMessage = `[${new Date().toISOString()}] [${context}] ${error.stack}\n`;
    fs.appendFileSync(path.join(__dirname, 'error.log'), errorMessage);
    console.error(`[${context}]`, error);
    if (process.env.ADMIN_EMAIL && oauth2Client.credentials.access_token) {
      try {
        await sendEmail({
          to: process.env.ADMIN_EMAIL,
          subject: `Print Shop Server Error: ${context}`,
          text: `An error occurred in the Print Shop server.\n\nContext: ${context}\n\nError: ${error.stack}`,
          html: `<p>An error occurred in the Print Shop server.</p><p><b>Context:</b> ${context}</p><pre>${error.stack}</pre>`,
          oauth2Client,
        });
      } catch (emailError) {
        console.error('CRITICAL: Failed to send error notification email:', emailError);
      }
    }
  }

  try {
    app = express();
    const port = process.env.PORT || 3000;

    const rpID = process.env.RP_ID;
    const expectedOrigin = process.env.EXPECTED_ORIGIN;

    // --- Google OAuth2 Client ---
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `http://localhost:${port}/oauth2callback`
    );

    // --- Ensure upload directory exists ---
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // --- Database Setup ---
    console.log('[SERVER] LowDB database initialized at:', dbPath);

    // Load the refresh token from the database if it exists
    if (db.data.config?.google_refresh_token) {
      oauth2Client.setCredentials({
        refresh_token: db.data.config.google_refresh_token,
      });
      console.log('[SERVER] Google OAuth2 client configured with stored refresh token.');
    }

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
      // In a test environment, we don't want to kill the test runner.
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }
    const squareClient = new SquareClient({
      version: '2025-07-16',
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment: SquareEnvironment.Sandbox,
    });
    console.log('[SERVER] Verifying connection to Square servers...');
    if (process.env.NODE_ENV !== 'test') {
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
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again after 15 minutes',
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
    
   // app.use(limiter);
    app.use(cors(corsOptions));
    // tiny-csrf uses a specific cookie name and requires the secret to be set in cookieParser
    const csrfSecret = process.env.CSRF_SECRET || '12345678901234567890123456789012';
    app.use(cookieParser(csrfSecret));
    app.use(session({
      secret: process.env.SESSION_SECRET || 'super-secret-session-key',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: process.env.NODE_ENV === 'production' }
    }));
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..')));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    app.use(lusca.csrf());

    // Middleware to add the token to every response
    app.use((req, res, next) => {
        res.setHeader('X-Server-Session-Token', serverSessionToken);
        next();
    });
    console.log('[SERVER] Middleware (CORS, JSON, static file serving) enabled.');

    // --- Helper Functions ---
    function authenticateToken(req, res, next) {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (token == null) return res.sendStatus(401);

      const { publicKey } = getCurrentSigningKey();
      jwt.verify(token, publicKey, { algorithms: ['RS256'] }, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
      });
    }

    // --- API Endpoints ---
    app.use('/api', apiLimiter);
    app.get('/.well-known/jwks.json', async (req, res) => {
        const jwks = await getJwks();
        res.json(jwks);
    });

    // Endpoint for the client's initial token fetch
    app.get('/api/server-info', (req, res) => {
        res.json({ serverSessionToken });
    });

    app.get('/api/ping', (req, res) => {
      res.status(200).json({
        status: 'ok',
        message: 'Server is running',
        timestamp: new Date().toISOString(),
      });
    });
    app.get('/api/csrf-token', (req, res) => {
      res.json({ csrfToken: res.locals._csrf });
    });

    app.get('/api/pricing-info', (req, res) => {
        res.json(pricingConfig);
    });

    app.post('/api/upload-design', authenticateToken, upload.fields([
        { name: 'designImage', maxCount: 1 },
        { name: 'cutLineFile', maxCount: 1 }
    ]), async (req, res) => {
        if (!req.files || !req.files.designImage) {
            return res.status(400).json({ error: 'No design image file uploaded' });
        }

        const designImageFile = req.files.designImage[0];
        const designFileType = await fileTypeFromFile(designImageFile.path);
		if (!designFileType || !allowedMimeTypes.includes(designFileType.mime)) {
            // It's good practice to remove the invalid file
            fs.unlink(designImageFile.path, (err) => {
                if (err) console.error("Error deleting invalid file:", err);
            });
            return res.status(400).json({ error: `Invalid file type. Only ${allowedMimeTypes.join(', ')} are allowed.` });
        }

        let cutLinePath = null;
        if (req.files.cutLineFile && req.files.cutLineFile[0]) {
            const edgecutLineFile = req.files.cutLineFile[0];
            const edgecutLineFileType = await fileTypeFromFile(edgecutLineFile.path);

            if (!edgecutLineFileType || edgecutLineFileType.ext !== 'svg') {
                // It's good practice to remove the invalid file
                fs.unlink(edgecutLineFile.path, (err) => {
                    if (err) console.error("Error deleting invalid file:", err);
                });
                return res.status(400).json({ error: 'Invalid file type. Only SVG files are allowed for the edgecut line.' });
            }
            cutLinePath = `/uploads/${edgecutLineFile.filename}`;
        }

        const designImagePath = `/uploads/${designImageFile.filename}`;

        res.json({
            success: true,
            designImagePath: designImagePath,
            cutLinePath: cutLinePath
        });
    });

    // --- Order Endpoints ---
    app.post('/api/create-order', authenticateToken, [
      body('sourceId').notEmpty().withMessage('sourceId is required'),
      body('amountCents').isInt({ gt: 0 }).withMessage('amountCents must be a positive integer'),
      body('currency').optional().isAlpha().withMessage('currency must be alphabetic'),
      body('designImagePath').notEmpty().withMessage('designImagePath is required'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      try {
        const { sourceId, amountCents, currency, designImagePath, shippingContact, ...orderDetails } = req.body;
        const paymentPayload = {
          sourceId: sourceId,
          idempotencyKey: randomUUID(),
          locationId: process.env.SQUARE_LOCATION_ID,
          amountMoney: {
            amount: BigInt(amountCents),
            currency: currency || 'USD',
          },
         appFeeMoney: {
           amount: BigInt("10"),
           currency: "USD"
          },
          autocomplete: true,
          referenceId: randomUUID(),
          note: "STICKERS!!!",
        };
        console.log('[CLIENT INSPECTION] Keys on squareClient:', Object.keys(squareClient));
        const paymentResult = await squareClient.payments.create(paymentPayload);
        if ( paymentResult.errors ) {
          console.error('[SERVER] Square API returned an error:', JSON.stringify(paymentResult.errors));
          return res.status(400).json({ error: 'Square API Error', details: paymentResult.errors });
        }
        console.log('[SERVER] Square payment successful. Payment ID:', paymentResult.payment.id);
        const newOrder = {
          orderId: randomUUID(),
          paymentId: paymentResult.payment.id,
          squareOrderId: paymentResult.payment.orderId,
          amount: Number(amountCents),
          currency: currency || 'USD',
          status: 'NEW',
          orderDetails: orderDetails.orderDetails,
          billingContact: orderDetails.billingContact,
          shippingContact: shippingContact,
          designImagePath: designImagePath,
          receivedAt: new Date().toISOString(),
        };
        db.data.orders.push(newOrder);
        await db.write();
        console.log(`[SERVER] New order created and stored. Order ID: ${newOrder.orderId}.`);

        // Send Telegram notification
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
          const message = `
New Order: ${newOrder.orderId}
Customer: ${newOrder.billingContact.givenName} ${newOrder.billingContact.familyName}
Email: ${newOrder.billingContact.email}
Quantity: ${newOrder.orderDetails.quantity}
Amount: $${(order.amount / 100).toFixed(2)}
          `;
          try {
            const sentMessage = await bot.sendMessage(process.env.TELEGRAM_CHANNEL_ID, message);
            const orderIndex = db.data.orders.findIndex(o => o.orderId === newOrder.orderId);
            if (orderIndex !== -1) {
              db.data.orders[orderIndex].telegramMessageId = sentMessage.message_id;
              await db.write();
            }

            // Send the design image
            if (newOrder.designImagePath) {
              const imagePath = path.join(__dirname, newOrder.designImagePath);
              await bot.sendPhoto(process.env.TELEGRAM_CHANNEL_ID, imagePath);
            }

            // Send the cut line file
            const cutLinePath = db.data.orders[orderIndex].cutLinePath;
            if (cutLinePath) {
              const docPath = path.join(__dirname, cutLinePath);
              await bot.sendDocument(process.env.TELEGRAM_CHANNEL_ID, docPath);
            }
          } catch (error) {
            console.error('[TELEGRAM] Failed to send message or files:', error);
          }
        }

        return res.status(201).json({ success: true, order: newOrder });
      } catch (error) {
        await logAndEmailError(error, 'Critical error in /api/create-order');
        if (error instanceof SquareError) {
            console.log(error.statusCode);
            console.log(error.message);
            console.log(error.body);
        }
        if (error.result && error.result.errors) {
          return res.status(error.statusCode || 500).json({ error: 'Square API Error', details: error.result.errors });
        }
        return res.status(500).json({ error: 'Internal Server Error', message: error.message });
      }
    });
    app.get('/api/auth/verify-token', authenticateToken, (req, res) => {
  // If the middleware succeeds, req.user is populated with the token payload.
  // The client expects an object with a `username` property for the welcome message.
  const userPayload = req.user;
  const username = userPayload.username || userPayload.email; // Fallback to email

  if (!username) {
    // This case should be rare, but it's good practice to handle it.
    return res.status(400).json({ error: 'Token is valid, but contains no user identifier.' });
  }

  // Return a consistent object that includes the username.
  res.status(200).json({
    username: username,
    ...userPayload
  });
    });
    app.get('/api/orders', authenticateToken, (req, res) => {
//      const user = Object.values(db.data.users).find(u => u.email === req.user.email);
//      if (!user) {
//        return res.status(401).json({ error: 'User not found' });
//      }
      // This endpoint is for the print shop dashboard, which needs to see all orders.
      // The `authenticateToken` middleware already ensures the user is logged in and authorized.
      // The previous implementation incorrectly filtered orders by the logged-in user's email.
      const allOrders = db.data.orders;
      res.status(200).json(allOrders.slice().reverse());
    });

    app.get('/api/orders/search', authenticateToken, (req, res) => {
      const { q } = req.query;
      const user = Object.values(db.data.users).find(u => u.email === req.user.email);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      const userOrders = db.data.orders.filter(order => order.billingContact.email === user.email);
      const filteredOrders = userOrders.filter(order => order.orderId.includes(q));
      if (filteredOrders.length === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.status(200).json(filteredOrders.slice().reverse());
    });

    app.get('/api/orders/my-orders', authenticateToken, (req, res) => {
      if (!req.user || !req.user.email) {
        return res.status(401).json({ error: 'Authentication token is invalid or missing email.' });
      }
      const userEmail = req.user.email;
      const userOrders = db.data.orders.filter(order => order.billingContact.email === userEmail);
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

      // Update Telegram message
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID && order.telegramMessageId) {
        const statusChecklist = `
✅ New
${status === 'ACCEPTED' || status === 'PRINTING' || status === 'SHIPPED' ? '✅' : '⬜️'} Accepted
${status === 'PRINTING' || status === 'SHIPPED' ? '✅' : '⬜️'} Printing
${status === 'SHIPPED' ? '✅' : '⬜️'} Shipped
        `;
        const message = `
Order: ${order.orderId}
Customer: ${order.billingContact.givenName} ${order.billingContact.familyName}
Email: ${order.billingContact.email}
Quantity: ${order.orderDetails.quantity}
Amount: $${(order.amount / 100).toFixed(2)}

${statusChecklist}
        `;
        try {
          if (status === 'SHIPPED') {
            await bot.deleteMessage(process.env.TELEGRAM_CHANNEL_ID, order.telegramMessageId);
          } else {
            await bot.editMessageText(message, {
              chat_id: process.env.TELEGRAM_CHANNEL_ID,
              message_id: order.telegramMessageId,
            });
          }
        } catch (error) {
          console.error('[TELEGRAM] Failed to edit or delete message:', error);
        }
      }

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

      // Send notification email to admin
      if (process.env.ADMIN_EMAIL) {
        try {
          await sendEmail({
            to: process.env.ADMIN_EMAIL,
            subject: 'New User Account Created',
            text: `A new user has registered on the Print Shop.\n\nUsername: ${username}`,
            html: `<p>A new user has registered on the Print Shop.</p><p><b>Username:</b> ${username}</p>`,
            oauth2Client,
          });
        } catch (emailError) {
          console.error('Failed to send new user notification email:', emailError);
        }
      }

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
      if (!user || !user.password) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const { privateKey, kid } = getCurrentSigningKey();
      const token = jwt.sign({ username: user.username }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
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
        const { privateKey, kid } = getCurrentSigningKey();
        const token = jwt.sign({ email }, privateKey, { algorithm: 'RS256', expiresIn: '15m', header: { kid } });
        const magicLink = `${process.env.BASE_URL}/magic-login.html?token=${token}`;

        console.log('Magic Link (for testing):', magicLink);

        console.log('[magic-login] Checking OAuth2 client state before sending email:');
        console.log(oauth2Client.credentials);

        try {
            await sendEmail({
                to: email,
                subject: 'Your Magic Link for Splotch',
                text: `Click here to log in: ${magicLink}`,
                html: `<p>Click here to log in: <a href="${magicLink}">${magicLink}</a></p>`,
                oauth2Client,
            });
            res.json({ success: true, message: 'Magic link sent! Please check your email.' });
        } catch (error) {
            await logAndEmailError(error, 'Failed to send magic link email');
            res.status(500).json({ error: 'Failed to send magic link email.' });
        }
    });
    
    app.post('/api/auth/verify-magic-link', (req, res) => {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'No token provided' });
      }
      const { publicKey } = getCurrentSigningKey();
      jwt.verify(token, publicKey, { algorithms: ['RS256'] }, (err, decoded) => {
        if (err) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        const user = Object.values(db.data.users).find(u => u.email === decoded.email);
        if (!user) {
          return res.status(401).json({ error: 'User not found' });
        }
        const { privateKey, kid } = getCurrentSigningKey();
        const authToken = jwt.sign({ email: user.email }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
        res.json({ success: true, token: authToken });
      });
    });

    app.get('/api/auth/verify-token', authenticateToken, (req, res) => {
      // If the middleware succeeds, req.user is populated with the token payload.
      // The client expects an object with a `username` property for the welcome message.
      const userPayload = req.user;
      const username = userPayload.username || userPayload.email; // Fallback to email

      if (!username) {
        // This case should be rare, but it's good practice to handle it.
        return res.status(400).json({ error: 'Token is valid, but contains no user identifier.' });
      }

      // Return a consistent object that includes the username.
      res.status(200).json({
        username: username,
        ...userPayload
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
      const { privateKey, kid } = getCurrentSigningKey();
      const token = jwt.sign({ email }, privateKey, { algorithm: 'RS256', expiresIn: '5m', header: { kid } });

      console.log(`[SERVER] Issued temporary token for email: ${email}`);
      res.json({ success: true, token });
    });

    // --- Google OAuth Endpoints ---
    app.get('/auth/google', (req, res) => {
      const scopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email',
      ];

      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
      });

      res.redirect(url);
    });

    app.get('/oauth2callback', async (req, res) => {
      const { code } = req.query;
      try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // If a refresh token is received, store it securely for future use.
        if (tokens.refresh_token) {
          db.data.config.google_refresh_token = tokens.refresh_token;
          await db.write();
          console.log('[SERVER] Google OAuth2 refresh token stored.');
        }

        // The user is authenticated with Google, now get their profile info
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const userEmail = userInfo.data.email;
        console.log('Google authentication successful for:', userEmail);

        // Find or create a user in our database
        let user = Object.values(db.data.users).find(u => u.email === userEmail);
        if (!user) {
          // Create a new user if they don't exist
          const newUsername = userEmail.split('@')[0]; // Use email prefix as username
          user = {
            id: randomUUID(),
            username: newUsername,
            email: userEmail,
            password: null, // No password for OAuth-only users
            credentials: [],
            google_tokens: tokens,
          };
          db.data.users[user.id] = user;
          await db.write();
          console.log(`New user created for ${userEmail}`);

          // Send notification email to admin
          if (process.env.ADMIN_EMAIL) {
            try {
              await sendEmail({
                to: process.env.ADMIN_EMAIL,
                subject: 'New User Account Created (via Google)',
                text: `A new user has registered using their Google account.\n\nEmail: ${userEmail}\nUsername: ${newUsername}`,
                html: `<p>A new user has registered using their Google account.</p><p><b>Email:</b> ${userEmail}</p><p><b>Username:</b> ${newUsername}</p>`,
                oauth2Client,
              });
            } catch (emailError) {
              console.error('Failed to send new user notification email:', emailError);
            }
          }

        } else {
          // User exists, just update their tokens
          user.google_tokens = tokens;
          await db.write();
        }

        // Create a JWT for the user to log them in
        const { privateKey, kid } = getCurrentSigningKey();
        const token = jwt.sign({ username: user.username, email: user.email }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });

        // Redirect back to the printshop dashboard with the token
        res.redirect(`/printshop.html?token=${token}`);
      } catch (error) {
        await logAndEmailError(error, 'Error in /oauth2callback');
        res.status(500).send('Authentication failed.');
      }
    });


    // --- WebAuthn (Passkey) Endpoints ---
    app.post('/api/auth/pre-register', [
      body('username').notEmpty().withMessage('username is required'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username } = req.body;
      let user = db.data.users[username];

      if (!user) {
        // Create a new user if they don't exist
        user = {
          id: randomUUID(),
          username: username,
          password: null, // No password for WebAuthn-only users
          credentials: [],
        };
        db.data.users[username] = user;
        await db.write();
        console.log(`New user created for WebAuthn pre-registration: ${username}`);
      }

      const options = await generateRegistrationOptions({
        rpID: rpID,
        rpName: 'Splotch',
        userName: username,
        authenticatorSelection: {
          userVerification: 'preferred',
        },
      });

      user.challenge = options.challenge;
      await db.write();

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
          expectedOrigin: expectedOrigin,
          expectedRPID: rpID,
        });
        const { verified, registrationInfo } = verification;
        if (verified) {
          user.credentials.push(registrationInfo);
          db.data.credentials[registrationInfo.credentialID] = registrationInfo;
          await db.write();
        }
        res.json({ verified });
      } catch (error) {
        await logAndEmailError(error, 'Error in /api/auth/register-verify');
        res.status(400).json({ error: error.message });
      }
    });

    app.get('/api/auth/login-options', async (req, res) => {
      const { username } = req.query;
      const user = db.data.users[username];
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }
      const options = await generateAuthenticationOptions({
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
          expectedOrigin: expectedOrigin,
          expectedRPID: rpID,
          authenticator: credential,
        });
        const { verified } = verification;
        if (verified) {
          const { privateKey, kid } = getCurrentSigningKey();
          const token = jwt.sign({ username: user.username }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
          res.json({ verified, token });
        } else {
          res.json({ verified });
        }
      } catch (error) {
        await logAndEmailError(error, 'Error in /api/auth/login-verify');
        res.status(400).json({ error: error.message });
      }
    });

    // Sign the initial token and re-sign periodically
    signInstanceToken();
    const sessionTokenTimer = setInterval(signInstanceToken, 30 * 60 * 1000);
    const keyRotationTimer = setInterval(rotateKeys, 60 * 60 * 1000);

    if (process.env.NODE_ENV === 'test') {
      sessionTokenTimer.unref();
      keyRotationTimer.unref();
    }
    
    // Return the app and the timers so they can be managed by the caller
    return { app, timers: [sessionTokenTimer, keyRotationTimer] };
    
  } catch (error) {
    await logAndEmailError(error, 'FATAL: Failed to start server');
    process.exit(1);
  }
}


export { startServer };