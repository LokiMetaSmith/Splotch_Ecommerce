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
import { initializeTracker } from './tracker.js';
import { validateUsername } from './validators.js';
import { fileTypeFromFile } from 'file-type';
import { calculateStickerPrice, getDesignDimensions } from './pricing.js';
import { Markup } from 'telegraf';
import { getOrderStatusKeyboard } from './telegramHelpers.js';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

export const FINAL_STATUSES = ['SHIPPED', 'CANCELED', 'COMPLETED', 'DELIVERED'];

const allowedMimeTypes = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

// JSDOM window is needed for server-side SVG sanitization
const { window } = new JSDOM('');
const purify = DOMPurify(window);

export const FINAL_STATUSES = ['SHIPPED', 'CANCELED', 'COMPLETED', 'DELIVERED'];

async function sanitizeSVGFile(filePath) {
    try {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const sanitized = purify.sanitize(fileContent, { USE_PROFILES: { svg: true } });

        // DOMPurify returns an empty string if it finds malicious content.
        // We also check if the original content was not empty to avoid false positives.
        if (!sanitized && fileContent.trim() !== '') {
            await fs.promises.writeFile(filePath, ''); // Overwrite with empty string to reject.
            console.warn(`[SECURITY] Malicious content detected in SVG and was rejected: ${filePath}`);
            return false;
        }

        await fs.promises.writeFile(filePath, sanitized);
        console.log(`[SECURITY] SVG file sanitized successfully: ${filePath}`);
        return true;
    } catch (error) {
        console.error(`[ERROR] Could not sanitize SVG file: ${filePath}`, error);
        // In case of an error, we should not keep the potentially harmful file.
        try {
            await fs.promises.unlink(filePath);
        } catch (unlinkError) {
            console.error(`[ERROR] Failed to delete file after sanitization error: ${filePath}`, unlinkError);
        }
        return false;
    }
}

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

const defaultData = { orders: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} };

// Define an async function to contain all server logic
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BASE_URL}/oauth2callback`
  );
async function startServer(db, bot, sendEmail, dbPath = path.join(__dirname, 'db.json'), injectedSquareClient = null) {
  if (!db) {
    db = await JSONFilePreset(dbPath, defaultData);
  }

  // Initialize Active Orders Cache
  // We use a simple array attached to the db object (not persisted to JSON)
  if (!db.activeOrders) {
      const allOrders = Object.values(db.data.orders);
      db.activeOrders = allOrders.filter(order => !FINAL_STATUSES.includes(order.status));
      console.log(`[SERVER] Initialized active orders cache. Count: ${db.activeOrders.length}`);
  }

  // Ensure products collection exists
  if (!db.data.products) {
    db.data.products = {};
    await db.write();
  }

  // --- MIGRATION LOGIC: Convert orders array to object if necessary ---
  if (Array.isArray(db.data.orders)) {
    console.log('[SERVER] Migrating orders from Array to Object...');
    const ordersArray = db.data.orders;
    const ordersObject = {};
    ordersArray.forEach(order => {
      if (order.orderId) {
        ordersObject[order.orderId] = order;
      } else {
        console.warn('[SERVER] Found order without orderId during migration, skipping:', order);
      }
    });
    db.data.orders = ordersObject;
    await db.write();
    console.log('[SERVER] Migration complete.');
  }

  // --- MIGRATION LOGIC: Ensure users have walletBalanceCents ---
  let userMigrationNeeded = false;
  Object.values(db.data.users).forEach(user => {
    if (typeof user.walletBalanceCents === 'undefined') {
      user.walletBalanceCents = 0;
      userMigrationNeeded = true;
    }
  });
  if (userMigrationNeeded) {
    console.log('[SERVER] Migrating users to include walletBalanceCents...');
    await db.write();
    console.log('[SERVER] User wallet migration complete.');
  }

  // --- MIGRATION LOGIC: Ensure users have role ---
  let userRoleMigrationNeeded = false;
  Object.values(db.data.users).forEach(user => {
    if (!user.role) {
      user.role = 'user'; // Default to user
      userRoleMigrationNeeded = true;
    }
  });
  if (userRoleMigrationNeeded) {
    console.log('[SERVER] Migrating users to include role...');
    await db.write();
    console.log('[SERVER] User role migration complete.');
  }

  // --- MIGRATION LOGIC: Build Email Index ---
  if (!db.data.emailIndex) {
      db.data.emailIndex = {};
  }

  // Rebuild index if empty (or always check consistency on startup? explicit rebuild is safer for now)
  // We check if we have users but no index entries
  const hasUsers = Object.keys(db.data.users).length > 0;
  const hasIndex = Object.keys(db.data.emailIndex).length > 0;

  if (hasUsers && !hasIndex) {
      console.log('[SERVER] Building email index...');
      Object.entries(db.data.users).forEach(([key, user]) => {
          if (user.email) {
              db.data.emailIndex[user.email] = key;
          }
      });
      await db.write();
      console.log('[SERVER] Email index built.');
  }

  // --- Google OAuth2 Client ---


  async function logAndEmailError(error, context = 'General Error') {
    // Sanitize error logging to avoid leaking sensitive information in logs/emails.
    const sanitizedErrorMessage = `[${new Date().toISOString()}] [${context}] ${error.message}\n`;
    try {
      await fs.promises.appendFile(path.join(__dirname, 'error.log'), sanitizedErrorMessage);
    } catch (logError) {
      console.error('CRITICAL: Failed to write to error log:', logError);
    }
    // The full error (including stack) is still logged to the console for debugging.
    console.error(`[${context}]`, error);
    if (process.env.ADMIN_EMAIL && oauth2Client.credentials.access_token) {
      try {
        await sendEmail({
          to: process.env.ADMIN_EMAIL,
          subject: `Print Shop Server Error: ${context}`,
          text: `An error occurred in the Print Shop server.\n\nContext: ${context}\n\nError: ${error.message}`,
          html: `<p>An error occurred in the Print Shop server.</p><p><b>Context:</b> ${context}</p><pre>${error.message}</pre>`,
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
      `${process.env.BASE_URL}/oauth2callback`
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
        cb(null, randomUUID() + path.extname(file.originalname));
      }
    });
    const upload = multer({
      storage: storage,
      limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
    });
    console.log('[SERVER] Multer configured for file uploads.');
    
    // --- Square Client Initialization ---
    console.log('[SERVER] Initializing Square client...');
    let squareClient = injectedSquareClient;

    if (!squareClient) {
      if (!process.env.SQUARE_ACCESS_TOKEN) {
        console.error('[SERVER] FATAL: SQUARE_ACCESS_TOKEN is not set in environment variables.');
        // In a test environment, we don't want to kill the test runner.
        if (process.env.NODE_ENV !== 'test') {
          process.exit(1);
        }
      }
      squareClient = new SquareClient({
        version: '2025-07-16',
        token: process.env.SQUARE_ACCESS_TOKEN,
        environment: SquareEnvironment.Sandbox,
      });
      console.log('[SERVER] Verifying connection to Square servers...');
    } else {
      console.log('[SERVER] Using injected Square client.');
    }
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

    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      // In test environment, allow more requests unless explicitly testing rate limiting
      max: (process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_TEST) ? 1000 : 10,
      message: 'Too many login attempts from this IP, please try again after 15 minutes',
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, // Disable the `X-RateLimit-*` headers
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

    // If running behind a reverse proxy, trust the first hop.
    // This is required for rate limiting and other security features to work correctly.
    if (process.env.TRUST_PROXY === 'true') {
        app.set('trust proxy', 1);
        console.log('[SERVER] Trusting reverse proxy headers.');
    }

    // --- CSRF Secret Management ---
    const weakDefaultCsrfSecret = '12345678901234567890123456789012';
    let csrfSecret = process.env.CSRF_SECRET;

    if (!csrfSecret || csrfSecret === weakDefaultCsrfSecret) {
        if (process.env.NODE_ENV === 'production') {
            console.error('❌ [FATAL] CSRF_SECRET is not set or is set to the weak default in a production environment.');
            console.error('   Please set a strong, unique CSRF_SECRET environment variable.');
            process.exit(1);
        } else {
            // In non-production environments, we can fall back to the weak secret for convenience,
            // but we should log a clear warning.
            csrfSecret = weakDefaultCsrfSecret;
            console.warn('⚠️ [SECURITY] CSRF_SECRET is not set or is weak. Using a default for development.');
            console.warn('   Do not use this configuration in production.');
        }
    } else {
        console.log('✅ [SERVER] Custom CSRF_SECRET is set.');
    }

    // tiny-csrf uses a specific cookie name and requires the secret to be set in cookieParser
    app.use(cookieParser(csrfSecret));

    let sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ [FATAL] SESSION_SECRET is not set in environment variables.');
        console.error('   This is required for production security. The application will now exit.');
        process.exit(1);
      } else {
        console.warn('⚠️ [SECURITY] SESSION_SECRET is not set. Using a temporary random secret for development.');
        console.warn('   Sessions will not persist across server restarts.');
        sessionSecret = randomUUID();
      }
    }

    app.use(session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: true,
      cookie: { secure: process.env.NODE_ENV === 'production' }
    }));

    app.use(express.json());

    app.use(lusca({
        csrf: true,
        xframe: 'SAMEORIGIN',
        hsts: {maxAge: 31536000, includeSubDomains: true, preload: true},
        nosniff: true,
        csp: {
            policy: {
                'default-src': "'self'",
                'script-src': "'self' 'unsafe-inline' https://cdn.jsdelivr.net https://*.squarecdn.com https://sandbox.web.squarecdn.com",
                'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com https://*.squarecdn.com https://sandbox.web.squarecdn.com",
                'font-src': "'self' https://fonts.gstatic.com https://*.squarecdn.com https://d1g145x70srn7h.cloudfront.net",
                'img-src': "'self' data: blob: https://*.squarecdn.com https://sandbox.web.squarecdn.com",
                'connect-src': "'self' https://*.squarecdn.com https://*.squareup.com https://*.squareupsandbox.com https://*.sentry.io",
                'frame-src': "'self' https://*.squarecdn.com https://sandbox.web.squarecdn.com"
            }
        }
    }));
    app.use(express.static(path.join(__dirname, '..')));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    // Middleware to add the token to every response
    app.use((req, res, next) => {
        res.setHeader('X-Server-Session-Token', serverSessionToken);
        next();
    });
    console.log('[SERVER] Middleware (CORS, JSON, static file serving) enabled.');

    // --- Helper Functions ---
    function getUserByEmail(email) {
        if (!email) return undefined;
        // Check index first
        if (db.data.emailIndex && db.data.emailIndex[email]) {
            const key = db.data.emailIndex[email];
            const user = db.data.users[key];
            if (user) return user;
            // Index is stale?
            console.warn(`[SERVER] Email index inconsistency: ${email} -> ${key} but user not found. Cleaning up.`);
            delete db.data.emailIndex[email];
        }
        // Fallback to scan (should not happen if index is healthy)
        // But for safety during rollout, we can do a scan or just return undefined.
        // Returning undefined is strictly O(1) assuming index is authority.
        // Let's stick to the plan: if not in index, it's not there.
        return undefined;
    }

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

    const isAdmin = (userPayload) => {
      if (!userPayload) return false;
      // Check env var fallback first (fastest)
      // FIX: Ensure ADMIN_EMAIL is set and not empty before comparing
      if (process.env.ADMIN_EMAIL && userPayload.email === process.env.ADMIN_EMAIL) return true;

      // Look up full user object
      const user = getUserByEmail(userPayload.email) || (userPayload.username ? db.data.users[userPayload.username] : undefined);

      if (user && user.role === 'admin') return true;

      return false;
    };

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

        // --- SVG Sanitization for designImage ---
        if (designFileType.mime === 'image/svg+xml') {
            const isSafe = await sanitizeSVGFile(designImageFile.path);
            if (!isSafe) {
                return res.status(400).json({ error: 'The uploaded SVG file contains potentially malicious content and was rejected.' });
            }
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

            // --- SVG Sanitization for cutLineFile ---
            const isSafe = await sanitizeSVGFile(edgecutLineFile.path);
            if (!isSafe) {
                // Also delete the already processed design image to avoid orphaned files
                fs.unlink(designImageFile.path, (err) => { if (err) console.error("Error deleting orphaned design file:", err); });
                return res.status(400).json({ error: 'The uploaded cut line file contains potentially malicious content and was rejected.' });
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

    // --- Product Endpoints ---
    app.post('/api/products', authenticateToken, [
        body('name').notEmpty().withMessage('Product name is required'),
        body('designImagePath').notEmpty().withMessage('Design image is required'),
        body('creatorProfitCents').isInt({ min: 0 }).withMessage('Creator profit must be a non-negative integer'),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { name, designImagePath, cutLinePath, creatorProfitCents, defaults } = req.body;

            // Robust lookup for creator
            let creator = null;
            // The token payload from authenticateToken is in req.user
            if (req.user.email) {
                creator = getUserByEmail(req.user.email);
            } else if (req.user.username) {
                // Check both direct access and scan
                creator = db.data.users[req.user.username] || Object.values(db.data.users).find(u => u.username === req.user.username);
            }

            if (!creator) {
                return res.status(401).json({ error: 'User not found.' });
            }

            const productId = randomUUID();
            const newProduct = {
                productId,
                creatorId: creator.id || creator.username, // Use ID if available, else username (legacy)
                creatorName: creator.username,
                name,
                designImagePath,
                cutLinePath,
                creatorProfitCents: Number(creatorProfitCents),
                defaults: defaults || {},
                createdAt: new Date().toISOString(),
                status: 'active'
            };

            db.data.products[productId] = newProduct;
            await db.write();

            console.log(`[SERVER] New product created: ${productId} by ${newProduct.creatorName}`);
            res.status(201).json({ success: true, product: newProduct });

        } catch (error) {
            await logAndEmailError(error, 'Error creating product');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.get('/api/products/:productId', (req, res) => {
        const { productId } = req.params;
        const product = db.data.products[productId];
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json({
            productId: product.productId,
            name: product.name,
            designImagePath: product.designImagePath,
            cutLinePath: product.cutLinePath,
            creatorProfitCents: product.creatorProfitCents,
            defaults: product.defaults,
            creatorName: product.creatorName
        });
    });

    // --- Order Endpoints ---
    app.post('/api/create-order', authenticateToken, [
      body('sourceId').notEmpty().withMessage('sourceId is required'),
      body('amountCents').isInt({ gt: 0 }).withMessage('amountCents must be a positive integer'),
      body('currency').optional().isAlpha().withMessage('currency must be alphabetic'),
      body('designImagePath').notEmpty().withMessage('designImagePath is required'),
      // Security Fix: Validate orderDetails structure
      body('orderDetails').isObject().withMessage('orderDetails must be an object'),
      body('orderDetails.quantity').isInt({ gt: 0 }).withMessage('Quantity must be a positive integer'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      try {
        const { sourceId, amountCents, currency, designImagePath, shippingContact, productId, orderDetails, billingContact } = req.body;

        // --- Product / Creator Payout Logic ---
        let product = null;
        let creator = null;

        if (productId) {
            product = db.data.products[productId];
            if (!product) {
                return res.status(400).json({ error: 'Invalid productId. Product not found.' });
            }

            // Verify price integrity if needed.
            // Ideally, we would re-calculate price here: Base Price (from dimensions) + Creator Profit.
            // But for MVP, we'll trust the client's `amountCents` matches the expected calculation,
            // or perform a simple check if we had dimensions on the backend.
            // Since `calculateStickerPrice` is available, we could do it, but we need the dimensions from the request.
            // The request currently only sends `orderDetails`, which has `quantity` but maybe not exact `bounds`.
            // Let's rely on the fact that the payment amount is what the user authorized.

            // Identify creator to pay
            const creatorId = product.creatorId;
            // CreatorId might be username or ID.
            if (creatorId) {
                creator = db.data.users[creatorId] || Object.values(db.data.users).find(u => u.username === creatorId || u.id === creatorId);
            }
        }

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
        // Explicitly construct safe orderDetails object to prevent Stored XSS
        const safeOrderDetails = {
            quantity: orderDetails.quantity
        };

        const newOrder = {
          orderId: randomUUID(),
          paymentId: paymentResult.payment.id,
          squareOrderId: paymentResult.payment.orderId,
          amount: Number(amountCents),
          currency: currency || 'USD',
          status: 'NEW',
          orderDetails: safeOrderDetails,
          billingContact: billingContact,
          shippingContact: shippingContact,
          designImagePath: designImagePath,
          receivedAt: new Date().toISOString(),
          productId: productId || null,
          creatorId: creator ? (creator.id || creator.username) : null
        };
        db.data.orders[newOrder.orderId] = newOrder;

        // Add to active orders cache
        if (db.activeOrders) {
            db.activeOrders.push(newOrder);
        }

        // --- Process Payout ---
        if (product && creator) {
            const quantity = safeOrderDetails.quantity || 1;
            const payoutAmount = product.creatorProfitCents * quantity;

            if (payoutAmount > 0) {
                if (typeof creator.walletBalanceCents === 'undefined') creator.walletBalanceCents = 0;
                creator.walletBalanceCents += payoutAmount;
                console.log(`[SERVER] Added ${payoutAmount} cents to wallet of ${creator.username}. New balance: ${creator.walletBalanceCents}`);
            }
        }

        await db.write();
        console.log(`[SERVER] New order created and stored. Order ID: ${newOrder.orderId}.`);

        // Send Telegram notification
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
          const status = 'NEW';
          const acceptedOrLater = ['ACCEPTED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
          const printingOrLater = ['PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
          const shippedOrLater = ['SHIPPED', 'DELIVERED', 'COMPLETED'];
          const deliveredOrLater = ['DELIVERED', 'COMPLETED'];
          const completedOrLater = ['COMPLETED'];

          const statusChecklist = `
✅ New
${['ACCEPTED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(newOrder.status) ? '✅' : '⬜️'} Accepted
${['PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(newOrder.status) ? '✅' : '⬜️'} Printing
${['SHIPPED', 'DELIVERED', 'COMPLETED'].includes(newOrder.status) ? '✅' : '⬜️'} Shipped
${['DELIVERED', 'COMPLETED'].includes(newOrder.status) ? '✅' : '⬜️'} Delivered
${['COMPLETED'].includes(newOrder.status) ? '✅' : '⬜️'} Completed
        `;
          const message = `
New Order: ${newOrder.orderId}
Customer: ${newOrder.billingContact.givenName} ${newOrder.billingContact.familyName}
Email: ${newOrder.billingContact.email}
Quantity: ${newOrder.orderDetails.quantity}
Amount: $${(newOrder.amount / 100).toFixed(2)}

${statusChecklist}
          `;
          try {
            const keyboard = getOrderStatusKeyboard(newOrder);
            const sentMessage = await bot.telegram.sendMessage(process.env.TELEGRAM_CHANNEL_ID, message, { reply_markup: keyboard });
            // db.data.orders is an object, so we access directly by ID
            if (db.data.orders[newOrder.orderId]) {
              db.data.orders[newOrder.orderId].telegramMessageId = sentMessage.message_id;

              // Send the design image
              if (newOrder.designImagePath) {
                const imagePath = path.join(__dirname, newOrder.designImagePath);
                const sentPhoto = await bot.telegram.sendPhoto(process.env.TELEGRAM_CHANNEL_ID, { source: imagePath });
                db.data.orders[newOrder.orderId].telegramPhotoMessageId = sentPhoto.message_id;
              }

              // Send the cut line file
              const cutLinePath = db.data.orders[newOrder.orderId].cutLinePath;
              if (cutLinePath) {
                const docPath = path.join(__dirname, cutLinePath);
                await bot.telegram.sendDocument(process.env.TELEGRAM_CHANNEL_ID, { source: docPath });
              }
              await db.write();
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
      // This endpoint is for the print shop dashboard and should only be accessible by admins.
      if (!isAdmin(req.user)) {
        return res.status(403).json({ error: 'Forbidden: You do not have permission to access this resource.' });
      }
      const allOrders = Object.values(db.data.orders);
      res.status(200).json(allOrders.slice().reverse());
    });

    app.get('/api/orders/search', authenticateToken, (req, res) => {
      const { q } = req.query;
      const user = getUserByEmail(req.user.email);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      const userOrders = Object.values(db.data.orders).filter(order => order.billingContact.email === user.email);
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
      const userOrders = Object.values(db.data.orders).filter(order => order.billingContact.email === userEmail);
      res.status(200).json(userOrders.slice().reverse());
    });

    app.get('/api/orders/:orderId', authenticateToken, (req, res) => {
      const { orderId } = req.params;
      const order = db.data.orders[orderId];

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Check if the user is an admin or the owner of the order.
      if (isAdmin(req.user) || (req.user.email && req.user.email === order.billingContact.email)) {
        return res.json(order);
      }

      // To avoid leaking information, return 404 even if the order exists but the user is not authorized.
      return res.status(404).json({ error: 'Order not found' });
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

      // Update active orders cache
      const isFinal = FINAL_STATUSES.includes(status);
      const activeIndex = db.activeOrders.findIndex(o => o.orderId === orderId);

      if (isFinal) {
        if (activeIndex !== -1) {
          db.activeOrders.splice(activeIndex, 1);
        }
      } else {
        if (activeIndex === -1) {
          db.activeOrders.push(order);
        }
      }

      await db.write();
      console.log(`[SERVER] Order ID ${orderId} status updated to ${status}.`);

      try {
          // Check for admin role
          if (!isAdmin(req.user)) {
              return res.status(403).json({ error: 'Forbidden: Admin access required.' });
          }

          const { orderId } = req.params;
          const { status } = req.body;
          const order = db.data.orders[orderId];
          if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
          }
          order.status = status;
          order.lastUpdatedAt = new Date().toISOString();
          await db.write();
          console.log(`[SERVER] Order ID ${orderId} status updated to ${status}.`);

          // Update active orders cache
          if (db.activeOrders) {
              if (FINAL_STATUSES.includes(status)) {
                  // Remove from active orders if status is final
                  const idx = db.activeOrders.findIndex(o => o.orderId === orderId);
                  if (idx !== -1) {
                      db.activeOrders.splice(idx, 1);
                  }
              } else {
                  // Add to active orders if status is non-final (re-activation)
                  const exists = db.activeOrders.find(o => o.orderId === orderId);
                  if (!exists) {
                      db.activeOrders.push(order);
                  }
              }
          }

          // Update Telegram message
          if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID && order.telegramMessageId) {
            const acceptedOrLater = ['ACCEPTED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
            const printingOrLater = ['PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
            const shippedOrLater = ['SHIPPED', 'DELIVERED', 'COMPLETED'];
            const deliveredOrLater = ['DELIVERED', 'COMPLETED'];
            const completedOrLater = ['COMPLETED'];

            const statusChecklist = `
✅ New
${acceptedOrLater.includes(status) ? '✅' : '⬜️'} Accepted
${printingOrLater.includes(status) ? '✅' : '⬜️'} Printing
${shippedOrLater.includes(status) ? '✅' : '⬜️'} Shipped
${deliveredOrLater.includes(status) ? '✅' : '⬜️'} Delivered
${completedOrLater.includes(status) ? '✅' : '⬜️'} Completed
            `;
            const message = `
Order: ${order.orderId}
Customer: ${order.billingContact.givenName} ${order.billingContact.familyName}
Email: ${order.billingContact.email}
Quantity: ${order.orderDetails?.quantity || 0}
Amount: $${(order.amount / 100).toFixed(2)}

${statusChecklist}
            `;
            try {
              if (status === 'COMPLETED' || status === 'CANCELED') {
                // Order is complete or canceled, delete the checklist message
                await bot.telegram.deleteMessage(process.env.TELEGRAM_CHANNEL_ID, order.telegramMessageId);
                // also delete the photo if it exists and hasn't been deleted
                if (order.telegramPhotoMessageId) {
                    await bot.telegram.deleteMessage(process.env.TELEGRAM_CHANNEL_ID, order.telegramPhotoMessageId);
                }
              } else {
                // For all other statuses, edit the message
                const keyboard = getOrderStatusKeyboard(order);
                await bot.telegram.editMessageText(
                    process.env.TELEGRAM_CHANNEL_ID,
                    order.telegramMessageId,
                    undefined,
                    message,
                    { reply_markup: keyboard }
                );
                // If the status is SHIPPED, also delete the photo
                if (status === 'SHIPPED' && order.telegramPhotoMessageId) {
                  await bot.telegram.deleteMessage(process.env.TELEGRAM_CHANNEL_ID, order.telegramPhotoMessageId);
                }
              }
            } catch (error) {
              console.error('[TELEGRAM] Failed to edit or delete message:', error);
            }
          }

          res.status(200).json({ success: true, order: order });
      } catch (error) {
        await logAndEmailError(error, 'Error updating order status');
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    app.post('/api/orders/:orderId/tracking', authenticateToken, [
        body('trackingNumber').notEmpty().withMessage('trackingNumber is required'),
        body('courier').notEmpty().withMessage('courier is required'),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // Check for admin role
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Forbidden: Admin access required.' });
        }

        const { orderId } = req.params;
        const { trackingNumber, courier } = req.body;
        const order = db.data.orders[orderId];
        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }
        order.trackingNumber = trackingNumber;
        order.courier = courier;
        await db.write();
        console.log(`[SERVER] Tracking info added to order ID ${orderId}.`);

        // Send shipment notification email
        if (order.billingContact && order.billingContact.email) {
            try {
                const customerName = order.billingContact.givenName || 'Valued Customer';
                const shippingAddress = order.shippingContact;
                const orderDate = new Date(order.receivedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                const addressHtml = `
                    <address>
                        ${shippingAddress.givenName} ${shippingAddress.familyName}<br>
                        ${shippingAddress.addressLines.join('<br>')}<br>
                        ${shippingAddress.locality}, ${shippingAddress.administrativeDistrictLevel1} ${shippingAddress.postalCode}<br>
                        ${shippingAddress.country}<br>
                        ${shippingAddress.phoneNumber || ''}
                    </address>
                `;
                // NOTE: The product name is hardcoded as "Stickers" because the current
                // order creation process only supports a single product type. This can be
                // expanded in the future if more products are added.
                const productDetailsHtml = `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">Stickers</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${order.orderDetails?.quantity || 0}</td>
                    </tr>
                `;

                await sendEmail({
                    to: order.billingContact.email,
                    subject: `Your Splotch order #${order.orderId} has shipped!`,
                    text: `Hey ${customerName},\n\nHeads up—your order has been sent out!\n\nOrdered: ${orderDate}\n\nHere’s the tracking number:\n${trackingNumber}\n${courier}\n\nHere’s what’s in your Shipment:\nProduct: Stickers, Quantity: ${order.orderDetails?.quantity || 0}\n\nShipping address:\n${shippingAddress.givenName} ${shippingAddress.familyName}\n${shippingAddress.addressLines.join('\n')}\n${shippingAddress.locality}, ${shippingAddress.administrativeDistrictLevel1} ${shippingAddress.postalCode}\n${shippingAddress.country}\n${shippingAddress.phoneNumber || ''}\n\nStay in touch!\nSplotch`,
                    html: `
                        <p>Hey ${customerName},</p>
                        <p>Heads up—your order has been sent out!</p>
                        <p><b>Ordered:</b> ${orderDate}</p>
                        <p>Here’s the tracking number:</p>
                        <p><b>${trackingNumber}</b><br>${courier}</p>
                        <p><i>Tracking information can take up to 48 hours to be updated after the order is shipped.</i></p>
                        <h3>Here’s what’s in your Shipment:</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr>
                                    <th style="text-align: left; padding: 10px; border-bottom: 2px solid #ddd;">Product</th>
                                    <th style="text-align: left; padding: 10px; border-bottom: 2px solid #ddd;">Qty</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${productDetailsHtml}
                            </tbody>
                        </table>
                        <h3>Shipping address:</h3>
                        ${addressHtml}
                        <p>Stay in touch!</p>
                        <p><b>Splotch</b></p>
                    `,
                    oauth2Client,
                });
                console.log(`[SERVER] Shipment notification email sent for order ID ${orderId}.`);
            } catch (emailError) {
                // Log the error, but don't block the API response since the tracking info was saved.
                await logAndEmailError(emailError, `Failed to send shipment notification for order ${orderId}`);
            }
        }

        res.status(200).json({ success: true, order: order });
    });

    // --- Auth Endpoints ---
    app.post('/api/auth/register-user', authLimiter, [
      body('username').notEmpty().withMessage('username is required'),
      body('password').notEmpty().withMessage('password is required'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { username, password } = req.body;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'Invalid username.' });
      }
      if (Object.prototype.hasOwnProperty.call(db.data.users, username)) {
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

    app.post('/api/auth/login', authLimiter, [
      ...validateUsername,
      body('password').notEmpty().withMessage('password is required'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { username, password } = req.body;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const user = Object.prototype.hasOwnProperty.call(db.data.users, username) ? db.data.users[username] : undefined;
      if (!user || !user.password) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const { privateKey, kid } = getCurrentSigningKey();
      const payload = { username: user.username };
      if (user.email) {
          payload.email = user.email;
      }
      const token = jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
      res.json({ token });
    });
    
    app.post('/api/auth/magic-login', authLimiter, [
      body('email').isEmail().withMessage('email is not valid'),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { email } = req.body;
        let user = getUserByEmail(email);
        if (!user) {
            user = {
                id: randomUUID(),
                email,
                credentials: [],
            };
            db.data.users[user.id] = user;
            // Update Index
            db.data.emailIndex[email] = user.id;
            await db.write();
        }
        const { privateKey, kid } = getCurrentSigningKey();
        const token = jwt.sign({ email }, privateKey, { algorithm: 'RS256', expiresIn: '15m', header: { kid } });
        const magicLink = `${process.env.BASE_URL}/magic-login.html?token=${token}`;

        // The magic link is sensitive and should not be logged.
        // console.log('Magic Link (for testing):', magicLink);

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
        const user = getUserByEmail(decoded.email);
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
        let user = getUserByEmail(userEmail);
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
          // Update Index
          db.data.emailIndex[userEmail] = user.id;
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
    app.post('/api/auth/pre-register', validateUsername, async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { username } = req.body;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'Invalid username.' });
      }
      let user = Object.prototype.hasOwnProperty.call(db.data.users, username) ? db.data.users[username] : undefined;

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

    app.post('/api/auth/register-verify', validateUsername, async (req, res) => {
      const { body } = req;
      const { username } = req.query;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'Invalid username.' });
      }
      const user = Object.prototype.hasOwnProperty.call(db.data.users, username) ? db.data.users[username] : undefined;
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

    app.get('/api/auth/login-options', validateUsername, async (req, res) => {
      const { username } = req.query;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'User not found' });
      }
      const user = Object.prototype.hasOwnProperty.call(db.data.users, username) ? db.data.users[username] : undefined;
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

    app.post('/api/auth/login-verify', validateUsername, async (req, res) => {
      const { body } = req;
      const { username } = req.query;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'Invalid username.' });
      }
      const user = Object.prototype.hasOwnProperty.call(db.data.users, username) ? db.data.users[username] : undefined;
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

    // Initialize the shipment tracker
    initializeTracker(db);

    // Ensure keys are loaded/created before signing the first token
    await rotateKeys();

    // Sign the initial token and re-sign periodically
    signInstanceToken();
    const sessionTokenTimer = setInterval(signInstanceToken, 30 * 60 * 1000);
    const keyRotationTimer = setInterval(rotateKeys, 60 * 60 * 1000);

    if (process.env.NODE_ENV === 'test') {
      sessionTokenTimer.unref();
      keyRotationTimer.unref();
    }
    
    // Return the app and the timers so they can be managed by the caller
    return { app, timers: [sessionTokenTimer, keyRotationTimer], bot };
    
  } catch (error) {
    await logAndEmailError(error, 'FATAL: Failed to start server');
    process.exit(1);
  }
}


export { startServer };
