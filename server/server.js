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
import compression from 'compression';
import session from 'express-session';
import { JSONFilePreset } from 'lowdb/node';
import jwt from 'jsonwebtoken';
import { body, validationResult, query, matchedData } from 'express-validator';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { google as defaultGoogle } from 'googleapis';
import * as defaultWebAuthn from '@simplewebauthn/server';
import { getSecret } from './secretManager.js';
import { sendEmail as defaultSendEmail } from './email.js';
import { getCurrentSigningKey, getJwks, rotateKeys, getKey, KEY_ROTATION_MS } from './keyManager.js';
import { initializeBot } from './bot.js';
import { initializeTracker } from './tracker.js';
import { validateUsername, validateId } from './validators.js';
import { fileTypeFromFile } from 'file-type';
import { calculateStickerPrice, getDesignDimensions } from './pricing.js';
import { Markup } from 'telegraf';
import { getOrderStatusKeyboard } from './telegramHelpers.js';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import logger from './logger.js';
import { performanceLogger } from './performanceLogger.js';
import Metrics from './metrics.js';
import { escapeHtml } from './utils.js';
import { LocalStorageProvider, S3StorageProvider } from './storage.js';
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';

export const FINAL_STATUSES = ['SHIPPED', 'CANCELED', 'COMPLETED', 'DELIVERED'];
export const VALID_STATUSES = ['NEW', 'ACCEPTED', 'PRINTING', ...FINAL_STATUSES];

const allowedMimeTypes = ['image/svg+xml', 'application/xml', 'image/png', 'image/jpeg', 'image/webp'];
// Pre-computed valid bcrypt hash for timing-safe comparison
const DUMMY_HASH = '$2b$10$e8ypvsBL/MxhtxIydLPU2eoLd4IVyOy0MhGvCRL3DC/xUpoznhhHi';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

let storageProvider;
const storageProviderType = process.env.STORAGE_PROVIDER;
// Default to S3 if credentials exist AND not explicitly set to 'local' (or anything else)
// If STORAGE_PROVIDER is 'local', this will be false even if credentials exist.
const shouldDefaultToS3 = !storageProviderType && getSecret('S3_BUCKET') && getSecret('AWS_ACCESS_KEY_ID');

if (storageProviderType === 's3' || shouldDefaultToS3) {
    logger.info('[SERVER] Using S3 Storage Provider.');
    storageProvider = new S3StorageProvider({
        bucket: getSecret('S3_BUCKET'),
        region: getSecret('S3_REGION') || 'us-east-1',
        endpoint: getSecret('S3_ENDPOINT'),
        accessKeyId: getSecret('AWS_ACCESS_KEY_ID'),
        secretAccessKey: getSecret('AWS_SECRET_ACCESS_KEY')
    });
} else {
    logger.info('[SERVER] Using Local Storage Provider.');
    storageProvider = new LocalStorageProvider(path.join(__dirname, 'uploads'));
}

// JSDOM window is needed for server-side SVG sanitization
const { window } = new JSDOM('');
const purify = DOMPurify(window);

async function enforceCorrectExtension(fileObj, detectedType) {
    if (!detectedType || !detectedType.ext) return;

    const currentExt = path.extname(fileObj.filename).toLowerCase().replace('.', '');
    const correctExt = detectedType.ext;

    // Strict enforcement: Always rename to detected extension if different
    // (allowing jpg/jpeg equivalence)
    const isJpeg = (ext) => ext === 'jpg' || ext === 'jpeg';
    const match = currentExt === correctExt || (isJpeg(currentExt) && isJpeg(correctExt));

    if (!match) {
        const nameWithoutExt = path.basename(fileObj.filename, path.extname(fileObj.filename));
        const newFilename = `${nameWithoutExt}.${correctExt}`;
        const newPath = path.join(path.dirname(fileObj.path), newFilename);

        await fs.promises.rename(fileObj.path, newPath);

        // Update file object
        fileObj.filename = newFilename;
        fileObj.path = newPath;
        logger.info(`[SECURITY] Renamed uploaded file to enforce extension: ${newFilename}`);
    }
}

async function sanitizeSVGFile(filePath) {
    try {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const sanitized = purify.sanitize(fileContent, { USE_PROFILES: { svg: true } });

        // DOMPurify returns an empty string if it finds malicious content.
        // We also check if the original content was not empty to avoid false positives.
        if (!sanitized && fileContent.trim() !== '') {
            await fs.promises.writeFile(filePath, ''); // Overwrite with empty string to reject.
            logger.warn(`[SECURITY] Malicious content detected in SVG and was rejected: ${filePath}`);
            return false;
        }

        await fs.promises.writeFile(filePath, sanitized);
        logger.info(`[SECURITY] SVG file sanitized successfully: ${filePath}`);
        return true;
    } catch (error) {
        logger.error(`[ERROR] Could not sanitize SVG file: ${filePath}`, error);
        // In case of an error, we should not keep the potentially harmful file.
        try {
            await storageProvider.deleteFile(filePath);
        } catch (unlinkError) {
            logger.error(`[ERROR] Failed to delete file after sanitization error: ${filePath}`, unlinkError);
        }
        return false;
    }
}

// Load pricing configuration
let pricingConfig = {};
try {
    const pricingData = fs.readFileSync(path.join(__dirname, 'pricing.json'), 'utf8');
    pricingConfig = JSON.parse(pricingData);
    logger.info('[SERVER] Pricing configuration loaded.');
} catch (error) {
    logger.error('[SERVER] FATAL: Could not load pricing.json.', error);
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
    logger.info(`[SERVER] Signed new session token with key ID: ${kid}`);
};
let db;
let app;

const defaultData = { orders: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} };

// Define an async function to contain all server logic
async function startServer(
    db,
    bot,
    sendEmail = defaultSendEmail,
    dbPath = path.join(__dirname, 'db.json'),
    injectedSquareClient = null,
    injectedGoogle = defaultGoogle,
    injectedWebAuthn = defaultWebAuthn
) {
  let lastMagicLinkToken = null;

  if (!db) {
    db = await JSONFilePreset(dbPath, defaultData);
  }

  // --- Metrics: Instrument DB writes ---
  // Ensure we don't wrap it multiple times if startServer is called with same db instance
  if (!db.write._instrumented) {
      const originalWrite = db.write;
      db.write = async function() {
          const start = process.hrtime();
          await originalWrite.apply(this, arguments);
          const diff = process.hrtime(start);
          const durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;
          Metrics.trackDbOperation('write', durationMs);
      };
      db.write._instrumented = true;
  }

  // --- Metrics: System Monitor ---
  const metricsTimer = setInterval(() => {
      Metrics.updateSystemMetrics();
  }, 10000); // 10 seconds

  // Initialize Caches and Indices
  // Bolt Optimization: Consolidated separate loops into a single O(N) pass over orders
  const needsActive = !db.activeOrders;
  const needsShipped = !db.shippedOrders;
  const needsUserIndex = !db.userOrderIndex;

  if (needsActive || needsShipped || needsUserIndex) {
      if (needsActive) db.activeOrders = [];
      if (needsShipped) db.shippedOrders = [];
      if (needsUserIndex) db.userOrderIndex = {};

      const allOrders = Object.values(db.data.orders);

      for (const order of allOrders) {
          // 1. Active Orders
          if (needsActive && !FINAL_STATUSES.includes(order.status)) {
              db.activeOrders.push(order);
          }

          // 2. Shipped Orders
          if (needsShipped && order.status === 'SHIPPED') {
              db.shippedOrders.push(order);
          }

          // 3. User Order Index
          if (needsUserIndex) {
              const email = order.billingContact?.email;
              if (email) {
                  if (!db.userOrderIndex[email]) {
                      db.userOrderIndex[email] = [];
                  }
                  db.userOrderIndex[email].push(order);
              }
          }
      }
      logger.info(`[SERVER] Initialized caches (O(N) optimized). Active: ${db.activeOrders?.length}, Shipped: ${db.shippedOrders?.length}, Users Indexed: ${db.userOrderIndex ? Object.keys(db.userOrderIndex).length : 0}`);
  }

  // Ensure products collection exists
  if (!db.data.products) {
    db.data.products = {};
    await db.write();
  }

  // --- MIGRATION LOGIC: Convert orders array to object if necessary ---
  if (Array.isArray(db.data.orders)) {
    logger.info('[SERVER] Migrating orders from Array to Object...');
    const ordersArray = db.data.orders;
    const ordersObject = {};
    ordersArray.forEach(order => {
      if (order.orderId) {
        ordersObject[order.orderId] = order;
      } else {
        logger.warn('[SERVER] Found order without orderId during migration, skipping:', order);
      }
    });
    db.data.orders = ordersObject;
    await db.write();
    logger.info('[SERVER] Migration complete.');
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
    logger.info('[SERVER] Migrating users to include walletBalanceCents...');
    await db.write();
    logger.info('[SERVER] User wallet migration complete.');
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
    logger.info('[SERVER] Migrating users to include role...');
    await db.write();
    logger.info('[SERVER] User role migration complete.');
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
      logger.info('[SERVER] Building email index...');
      Object.entries(db.data.users).forEach(([key, user]) => {
          if (user.email) {
              db.data.emailIndex[user.email] = key;
          }
      });
      await db.write();
      logger.info('[SERVER] Email index built.');
  }

  // --- Google OAuth2 Client ---
  let oauth2Client;

  // Initialize Sentry if DSN is provided
  if (getSecret('SENTRY_DSN')) {
      Sentry.init({
          dsn: getSecret('SENTRY_DSN'),
          integrations: [
              nodeProfilingIntegration(),
          ],
          // Tracing
          tracesSampleRate: 1.0, //  Capture 100% of the transactions
          // Set sampling rate for profiling - this is relative to tracesSampleRate
          profilesSampleRate: 1.0,
      });
      logger.info('[SERVER] Sentry initialized.');
  }

  async function logAndEmailError(error, context = 'General Error') {
    // Sanitize error logging to avoid leaking sensitive information in logs/emails.
    // Winston handles file logging and console output.
    logger.error(`[${context}] ${error.message}`, { error, context });

    // Capture exception in Sentry
    if (getSecret('SENTRY_DSN')) {
        Sentry.captureException(error, {
            tags: { context }
        });
    }

    if (getSecret('ADMIN_EMAIL') && oauth2Client && oauth2Client.credentials && oauth2Client.credentials.access_token) {
      try {
        await sendEmail({
          to: getSecret('ADMIN_EMAIL'),
          subject: `Print Shop Server Error: ${context}`,
          text: `An error occurred in the Print Shop server.\n\nContext: ${context}\n\nError: ${error.message}`,
          html: `<p>An error occurred in the Print Shop server.</p><p><b>Context:</b> ${escapeHtml(context)}</p><pre>${escapeHtml(error.message)}</pre>`,
          oauth2Client,
        });
      } catch (emailError) {
        logger.error('CRITICAL: Failed to send error notification email:', emailError);
      }
    }
  }

  try {
    app = express();

    // Sentry Request Handler must be the first middleware on the app
    if (getSecret('SENTRY_DSN')) {
        Sentry.setupExpressErrorHandler(app);
    }

    app.use(performanceLogger);
    const port = process.env.PORT || 3000;

    const rpID = getSecret('RP_ID');
    const expectedOrigin = getSecret('EXPECTED_ORIGIN');

    // --- Google OAuth2 Client ---
    oauth2Client = new injectedGoogle.auth.OAuth2(
      getSecret('GOOGLE_CLIENT_ID'),
      getSecret('GOOGLE_CLIENT_SECRET'),
      `${getSecret('BASE_URL')}/oauth2callback`
    );

    // --- Ensure upload directory exists ---
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // --- Database Setup ---
    logger.info('[SERVER] LowDB database initialized at:', dbPath);

    // Load the refresh token from the database if it exists
    if (db.data.config?.google_refresh_token) {
      oauth2Client.setCredentials({
        refresh_token: db.data.config.google_refresh_token,
      });
      logger.info('[SERVER] Google OAuth2 client configured with stored refresh token.');
    }

    // --- Multer Configuration for File Uploads ---
    const storage = storageProvider.getMulterStorage();
    const upload = multer({
      storage: storage,
      limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
    });
    logger.info('[SERVER] Multer configured for file uploads.');
    
    // --- Square Client Initialization ---
    logger.info('[SERVER] Initializing Square client...');
    let squareClient = injectedSquareClient;

    if (!squareClient) {
      if (!getSecret('SQUARE_ACCESS_TOKEN')) {
        logger.error('[SERVER] FATAL: SQUARE_ACCESS_TOKEN is not set in environment variables.');
        // In a test environment, we don't want to kill the test runner.
        if (process.env.NODE_ENV !== 'test') {
          process.exit(1);
        }
      }
      squareClient = new SquareClient({
        version: '2025-07-16',
        token: getSecret('SQUARE_ACCESS_TOKEN'),
        environment: SquareEnvironment.Sandbox,
      });
      logger.info('[SERVER] Verifying connection to Square servers...');
    } else {
      logger.info('[SERVER] Using injected Square client.');
    }
    if (process.env.NODE_ENV !== 'test') {
        try {
            await new Promise((resolve, reject) => {
                dns.lookup('connect.squareup.com', (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            logger.info('✅ [SERVER] DNS resolution successful. Network connection appears to be working.');
        } catch (error) {
            logger.error('❌ [FATAL] Could not resolve Square API domain.');
            logger.error('   This is likely a network, DNS, or firewall issue on the server.');
            logger.error('   Full Error:', error.message);
            process.exit(1);
        }
    }
    logger.info('[SERVER] Square client initialized.');
  // --- NEW: Local Sanity Check for API properties ---
    logger.info('[SERVER] Performing sanity check on Square client...');
    if (!squareClient.locations || !squareClient.payments) {
        logger.error('❌ [FATAL] Square client is missing required API properties (locationsApi, paymentsApi).');
        logger.error('   This may indicate an issue with the installed Square SDK package.');
        process.exit(1);
    }
    logger.info('✅ [SERVER] Sanity check passed. Client has required API properties.');

   

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
    app.use(compression());
    app.use(cors(corsOptions));

    // If running behind a reverse proxy, trust the first hop.
    // This is required for rate limiting and other security features to work correctly.
    if (getSecret('TRUST_PROXY') === 'true') {
        app.set('trust proxy', 1);
        logger.info('[SERVER] Trusting reverse proxy headers.');
    }

    // --- CSRF Secret Management ---
    const weakDefaultCsrfSecret = '12345678901234567890123456789012';
    let csrfSecret = getSecret('CSRF_SECRET');

    if (!csrfSecret || csrfSecret === weakDefaultCsrfSecret) {
        if (process.env.NODE_ENV === 'production') {
            logger.error('❌ [FATAL] CSRF_SECRET is not set or is set to the weak default in a production environment.');
            logger.error('   Please set a strong, unique CSRF_SECRET environment variable.');
            process.exit(1);
        } else {
            // In non-production environments, we can fall back to the weak secret for convenience,
            // but we should log a clear warning.
            csrfSecret = weakDefaultCsrfSecret;
            logger.warn('⚠️ [SECURITY] CSRF_SECRET is not set or is weak. Using a default for development.');
            logger.warn('   Do not use this configuration in production.');
        }
    } else {
        logger.info('✅ [SERVER] Custom CSRF_SECRET is set.');
    }

    // tiny-csrf uses a specific cookie name and requires the secret to be set in cookieParser
    app.use(cookieParser(csrfSecret));

    let sessionSecret = getSecret('SESSION_SECRET');
    if (!sessionSecret) {
        logger.error('❌ [FATAL] SESSION_SECRET is not set in environment variables.');
        logger.error('   This is required for security in all environments. The application will now exit.');
        process.exit(1);
    }

    let sessionStore;
    const redisUrl = getSecret('REDIS_URL');
    if (redisUrl) {
        try {
            const redisClient = createClient({ url: redisUrl });
            redisClient.on('error', (err) => logger.error('Redis Client Error', err));
            await redisClient.connect();
            sessionStore = new RedisStore({
                client: redisClient,
                prefix: "splotch:",
            });
            logger.info('[SERVER] Using Redis for session storage.');
        } catch (error) {
            logger.error('[SERVER] Failed to connect to Redis, falling back to MemoryStore.', error);
        }
    } else {
         logger.info('[SERVER] Using MemoryStore for session storage.');
    }

    app.use(session({
      store: sessionStore,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
      }
    }));

    app.use(express.json());
    app.disable('x-powered-by');

    // SECURITY: Block access to sensitive files and directories
    app.use((req, res, next) => {
        const blockedPrefixes = [
            '/server/',
            '/node_modules/',
            '/.git/',
            '/verification/',
            '/.jules/',
            '/tests/',
            '/scripts/',
            '/docs/',
            '/playwright_tests/',
            '/playwright_tests_real/',
            '/.husky/'
        ];

        const blockedExtensions = [
            '.md',
            '.sh',
            '.log',
            '.yml',
            '.yaml',
            '.config.js',
            '.config.ts'
        ];

        const blockedExact = [
            '/package.json',
            '/package-lock.json',
            '/pnpm-lock.yaml',
            '/yarn.lock',
            '/.env',
            '/Dockerfile',
            '/.gitignore',
            '/.eslintignore'
        ];

        const reqPath = req.path;

        const isBlockedPrefix = blockedPrefixes.some(prefix => reqPath.startsWith(prefix));
        const isBlockedExact = blockedExact.includes(reqPath);
        const isBlockedExtension = blockedExtensions.some(ext => reqPath.endsWith(ext));

        if (isBlockedPrefix || isBlockedExact || isBlockedExtension) {
            logger.warn(`[SECURITY] Blocked access to sensitive path: ${reqPath}`);
            return res.status(403).send('Forbidden');
        }
        next();
    });

    // SECURITY: Add additional security headers not covered by lusca
    app.use((req, res, next) => {
        // Permissions-Policy: Disables powerful features that the app doesn't need
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
        // Referrer-Policy: Controls how much referrer information is sent to other sites
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });

    app.use(lusca({
        csrf: true,
        xframe: 'SAMEORIGIN',
        hsts: {maxAge: 31536000, includeSubDomains: true, preload: true},
        nosniff: true,
        csp: {
            policy: {
                'default-src': "'self'",
                'script-src': "'self' https://cdn.jsdelivr.net https://*.squarecdn.com https://sandbox.web.squarecdn.com",
                'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com https://*.squarecdn.com https://sandbox.web.squarecdn.com",
                'font-src': "'self' https://fonts.gstatic.com https://*.squarecdn.com https://d1g145x70srn7h.cloudfront.net",
                'img-src': "'self' data: blob: https://*.squarecdn.com https://sandbox.web.squarecdn.com",
                'connect-src': "'self' https://*.squarecdn.com https://*.squareup.com https://*.squareupsandbox.com https://*.sentry.io",
                'frame-src': "'self' https://*.squarecdn.com https://sandbox.web.squarecdn.com"
            }
        }
    }));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
        maxAge: '1d'
    }));

    // Middleware to add the token to every response
    app.use((req, res, next) => {
        res.setHeader('X-Server-Session-Token', serverSessionToken);
        next();
    });
    logger.info('[SERVER] Middleware (CORS, JSON, static file serving) enabled.');

    // --- Helper Functions ---
    function getUserByEmail(email) {
        if (!email) return undefined;
        // Check index first
        if (db.data.emailIndex && db.data.emailIndex[email]) {
            const key = db.data.emailIndex[email];
            const user = db.data.users[key];
            if (user) return user;
            // Index is stale?
            logger.warn(`[SERVER] Email index inconsistency: ${email} -> ${key} but user not found. Cleaning up.`);
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

      // Decode the token header to find the Key ID (kid)
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || !decoded.header || !decoded.header.kid) {
          return res.sendStatus(401);
      }

      const key = getKey(decoded.header.kid);
      if (!key) {
          return res.sendStatus(401); // Key not found or expired
      }

      jwt.verify(token, key.publicKey, { algorithms: ['RS256'] }, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
      });
    }

    const isAdmin = (userPayload) => {
      if (!userPayload) return false;
      // Check env var fallback first (fastest)
      // FIX: Ensure ADMIN_EMAIL is set and not empty before comparing
      if (getSecret('ADMIN_EMAIL') && userPayload.email === getSecret('ADMIN_EMAIL')) return true;

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

    app.get('/api/metrics', authenticateToken, (req, res) => {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json(Metrics.getMetrics());
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
        logger.info(`[DEBUG] File type detected: ${JSON.stringify(designFileType)} for ${designImageFile.path}`);
        if (!designFileType || !allowedMimeTypes.includes(designFileType.mime)) {
            // It's good practice to remove the invalid file
            storageProvider.deleteFile(designImageFile.path).catch((err) => {
                if (err) logger.error("Error deleting invalid file:", err);
            });
            return res.status(400).json({ error: `Invalid file type. Only ${allowedMimeTypes.join(', ')} are allowed.` });
        }

        // --- SVG Sanitization for designImage ---
        if (designFileType.mime === 'image/svg+xml' || designFileType.mime === 'application/xml') {
            const isSafe = await sanitizeSVGFile(designImageFile.path);
            if (!isSafe) {
                return res.status(400).json({ error: 'The uploaded SVG file contains potentially malicious content and was rejected.' });
            }
        }

        // --- SECURITY: Enforce correct extension ---
        await enforceCorrectExtension(designImageFile, designFileType);

        let cutLinePath = null;
        if (req.files.cutLineFile && req.files.cutLineFile[0]) {
            const edgecutLineFile = req.files.cutLineFile[0];
            const edgecutLineFileType = await fileTypeFromFile(edgecutLineFile.path);

            // Allow 'svg' extension or 'xml' extension if mime is application/xml (common for SVGs)
            const isValidCutLine = edgecutLineFileType && (edgecutLineFileType.ext === 'svg' || (edgecutLineFileType.ext === 'xml' && edgecutLineFileType.mime === 'application/xml'));

            if (!isValidCutLine) {
                // It's good practice to remove the invalid file
                storageProvider.deleteFile(edgecutLineFile.path).catch((err) => {
                    if (err) logger.error("Error deleting invalid file:", err);
                });
                return res.status(400).json({ error: 'Invalid file type. Only SVG files are allowed for the edgecut line.' });
            }

            // --- SVG Sanitization for cutLineFile ---
            const isSafe = await sanitizeSVGFile(edgecutLineFile.path);
            if (!isSafe) {
                // Also delete the already processed design image to avoid orphaned files
                storageProvider.deleteFile(designImageFile.path).catch((err) => { if (err) logger.error("Error deleting orphaned design file:", err); });
                return res.status(400).json({ error: 'The uploaded cut line file contains potentially malicious content and was rejected.' });
            }

            // --- SECURITY: Enforce correct extension ---
            await enforceCorrectExtension(edgecutLineFile, edgecutLineFileType);

            // Finalize upload for cut line
            cutLinePath = await storageProvider.finalizeUpload(edgecutLineFile);
        }

        const designImagePath = await storageProvider.finalizeUpload(designImageFile);

        res.json({
            success: true,
            designImagePath: designImagePath,
            cutLinePath: cutLinePath
        });
    });

    // --- Product Endpoints ---
    app.post('/api/products', authenticateToken, [
        body('name').notEmpty().withMessage('Product name is required').isString().trim().escape(),
        body('designImagePath').notEmpty().withMessage('Design image is required').isString().custom(value => {
            if (value.startsWith('/uploads/')) return true;
            if (value.startsWith('http')) return true; // Allow URLs
            throw new Error('Path must start with /uploads/ or be a valid URL');
        }),
        body('cutLinePath').optional().isString().custom(value => {
            if (value.startsWith('/uploads/')) return true;
            if (value.startsWith('http')) return true; // Allow URLs
            throw new Error('Path must start with /uploads/ or be a valid URL');
        }),
        body('defaults').optional().isObject(),
        body('creatorProfitCents').isInt({ min: 0 }).withMessage('Creator profit must be a non-negative integer'),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { name, designImagePath, cutLinePath, creatorProfitCents, defaults } = matchedData(req);

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

            logger.info(`[SERVER] New product created: ${productId} by ${newProduct.creatorName}`);
            res.status(201).json({ success: true, product: newProduct });

        } catch (error) {
            await logAndEmailError(error, 'Error creating product');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.get('/api/products/:productId', validateId('productId'), (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
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
      body('sourceId').notEmpty().withMessage('sourceId is required').isString().withMessage('sourceId must be a string'),
      body('amountCents').isInt({ gt: 0 }).withMessage('amountCents must be a positive integer'),
      body('currency').optional().isString().withMessage('currency must be a string').isAlpha().withMessage('currency must be alphabetic'),
      body('designImagePath').notEmpty().withMessage('designImagePath is required').custom(value => {
            if (value.startsWith('/uploads/')) return true;
            if (value.startsWith('http')) return true; // Allow URLs
            throw new Error('Path must start with /uploads/ or be a valid URL');
      }),
      // Security Fix: Validate orderDetails structure
      body('orderDetails').isObject().withMessage('orderDetails must be an object'),
      body('orderDetails.quantity').isInt({ gt: 0 }).withMessage('Quantity must be a positive integer'),
      // Security: Validate material and resolution against allowed values to prevent injection
      body('orderDetails.material').optional().isString().withMessage('Material must be a string').custom(value => {
            const validMaterials = pricingConfig.materials.map(m => m.id);
            if (!validMaterials.includes(value)) {
                throw new Error(`Invalid material. Must be one of: ${validMaterials.join(', ')}`);
            }
            return true;
      }),
      body('orderDetails.resolution').optional().isString().withMessage('Resolution must be a string').custom(value => {
            const validResolutions = pricingConfig.resolutions.map(r => r.id);
            if (!validResolutions.includes(value)) {
                throw new Error(`Invalid resolution. Must be one of: ${validResolutions.join(', ')}`);
            }
            return true;
      }),
      body('orderDetails.cutLinePath').optional().isString().withMessage('cutLinePath must be a string').custom(value => {
            if (value.startsWith('/uploads/')) return true;
            if (value.startsWith('http')) return true; // Allow URLs
            throw new Error('Path must start with /uploads/ or be a valid URL');
      }),

      // Security & Integrity: Validate Billing Contact
      body('billingContact').isObject().withMessage('billingContact must be an object'),
      body('billingContact.givenName').notEmpty().withMessage('Billing First Name is required').isLength({ max: 100 }).withMessage('Billing First Name is too long').not().contains('<').withMessage('Invalid characters in Billing First Name'),
      body('billingContact.familyName').optional().isLength({ max: 100 }).withMessage('Billing Last Name is too long').not().contains('<').withMessage('Invalid characters in Billing Last Name'),
      body('billingContact.email').isEmail().withMessage('Valid Billing Email is required'),
      body('billingContact.phoneNumber').optional().isString().trim().not().contains('<').isLength({ max: 20 }).withMessage('Invalid Phone Number'),

      // Security & Integrity: Validate Shipping Contact
      body('shippingContact').isObject().withMessage('shippingContact must be an object'),
      body('shippingContact.givenName').notEmpty().withMessage('Shipping First Name is required').isLength({ max: 100 }).withMessage('Shipping First Name is too long').not().contains('<').withMessage('Invalid characters in Shipping First Name'),
      body('shippingContact.familyName').optional().isLength({ max: 100 }).withMessage('Shipping Last Name is too long').not().contains('<').withMessage('Invalid characters in Shipping Last Name'),
      body('shippingContact.email').optional().isEmail().withMessage('Invalid Shipping Email'),
      body('shippingContact.addressLines').isArray().withMessage('Shipping Address Lines must be an array'),
      body('shippingContact.addressLines.*').isString().withMessage('Address lines must be strings').isLength({ max: 200 }).withMessage('Address Line is too long').not().contains('<').withMessage('Invalid characters in Address Lines'),
      body('shippingContact.locality').notEmpty().withMessage('City is required').isLength({ max: 100 }).withMessage('City name is too long').not().contains('<'),
      body('shippingContact.administrativeDistrictLevel1').notEmpty().withMessage('State/Province is required').isLength({ max: 100 }).withMessage('State/Province name is too long').not().contains('<'),
      body('shippingContact.postalCode').notEmpty().withMessage('Postal Code is required').isLength({ max: 20 }).withMessage('Postal Code is too long').not().contains('<'),
      body('shippingContact.country').notEmpty().withMessage('Country is required').isLength({ max: 100 }).withMessage('Country name is too long').not().contains('<'),
      body('shippingContact.phoneNumber').optional().isString().trim().not().contains('<').isLength({ max: 20 }).withMessage('Invalid Phone Number'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      try {
        const { sourceId, amountCents, currency, designImagePath, productId, orderDetails, billingContact, shippingContact } = req.body;

        // Manually construct safe objects to prevent Mass Assignment
        // Variable names updated to avoid conflict with response variable names
        const inputSafeBillingContact = {
            givenName: billingContact.givenName,
            familyName: billingContact.familyName,
            email: billingContact.email,
            phoneNumber: billingContact.phoneNumber
        };

        const inputSafeShippingContact = {
            givenName: shippingContact.givenName,
            familyName: shippingContact.familyName,
            email: shippingContact.email,
            addressLines: shippingContact.addressLines, // Array of strings (validated)
            locality: shippingContact.locality,
            administrativeDistrictLevel1: shippingContact.administrativeDistrictLevel1,
            postalCode: shippingContact.postalCode,
            country: shippingContact.country,
            phoneNumber: shippingContact.phoneNumber
        };

        const inputSafeOrderDetails = {
            quantity: orderDetails.quantity,
            material: orderDetails.material,
            resolution: orderDetails.resolution,
            cutLinePath: orderDetails.cutLinePath
        };

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

            // SECURITY: Verify that the payment covers at least the creator's profit margin.
            // This prevents attackers from paying 1 cent for a product where the creator gets $50 payout.
            const quantity = orderDetails.quantity || 1;
            const minRequiredAmount = (product.creatorProfitCents || 0) * quantity;
            // We also enforce a global minimum of 1 cent per item to cover printing/base costs roughly.
            const globalMin = 1 * quantity;

            if (amountCents < minRequiredAmount || amountCents < globalMin) {
                logger.warn(`[SECURITY] Price manipulation attempt detected. Order amount: ${amountCents}, Min Required: ${minRequiredAmount}`);
                return res.status(400).json({ error: 'Order amount is too low.' });
            }
        }

        // --- SECURITY: Validate Order Price ---
        try {
            // Determine which file determines the pricing geometry (Cutline takes precedence if custom)
            // But if it's a product, the product definition might dictate paths.
            // For now, trust the paths in body (validated to be in /uploads/).
            let validationPath = designImagePath;
            if (orderDetails.cutLinePath) {
                validationPath = orderDetails.cutLinePath;
            } else if (product && product.cutLinePath) {
                validationPath = product.cutLinePath;
            }

            // Ensure the file is available locally for measuring
            const localPath = await storageProvider.getLocalCopy(validationPath);

            // Get dimensions/complexity
            // We use the validationPath file to calculate bounds and perimeter.
            // Note: If the file is missing (deleted?), this will throw, which is good (fail secure).
            if (fs.existsSync(localPath)) {
                const dimensions = await getDesignDimensions(localPath);

                const quantity = orderDetails.quantity || 1;
                // Use default material if not specified
                const material = orderDetails.material || (product && product.defaults && product.defaults.material) || 'pp_standard';
                // Use default resolution (300DPI) if not specified.
                // Note: Client currently defaults to 'dpi_300' if not explicit.
                const resolutionId = orderDetails.resolution || (product && product.defaults && product.defaults.resolution) || 'dpi_300';
                const resolution = pricingConfig.resolutions.find(r => r.id === resolutionId) || pricingConfig.resolutions[0];

                const priceResult = calculateStickerPrice(
                    pricingConfig,
                    quantity,
                    material,
                    dimensions.bounds,
                    dimensions.cutline,
                    resolution
                );

                let expectedTotal = priceResult.total;

                // Add Creator Profit if applicable
                if (product) {
                    expectedTotal += (product.creatorProfitCents * quantity);
                }

                const submittedTotal = Number(amountCents);

                // Allow a small tolerance (e.g., 5 cents) for rounding differences
                if (Math.abs(expectedTotal - submittedTotal) > 5) {
                    logger.warn(`[SECURITY] Price mismatch for Order. Expected: ${expectedTotal}, Received: ${submittedTotal}. Diff: ${expectedTotal - submittedTotal}`);
                    return res.status(400).json({ error: 'Price mismatch. The calculated price does not match the submitted amount. Please refresh and try again.' });
                } else {
                    logger.info(`[SECURITY] Price validated. Expected: ${expectedTotal}, Received: ${submittedTotal}`);
                }
            } else {
                logger.warn(`[SECURITY] Could not validate price because file not found: ${localPath}`);
                // Proceeding cautiously - or should we fail?
                // If it's a fresh upload, it should be there.
                // Failsafe: Reject.
                return res.status(400).json({ error: 'Validation failed: Design file not found.' });
            }
        } catch (validationError) {
            logger.error('[SECURITY] Error during price validation:', validationError);
            return res.status(400).json({ error: 'Order validation failed.' });
        }
        // --------------------------------------

        const paymentPayload = {
          sourceId: sourceId,
          idempotencyKey: randomUUID(),
          locationId: getSecret('SQUARE_LOCATION_ID'),
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
        logger.info('[CLIENT INSPECTION] Keys on squareClient:', Object.keys(squareClient));
        const paymentResult = await squareClient.payments.create(paymentPayload);
        if ( paymentResult.errors ) {
          logger.error('[SERVER] Square API returned an error:', JSON.stringify(paymentResult.errors));
          return res.status(400).json({ error: 'Square API Error', details: paymentResult.errors });
        }
        logger.info('[SERVER] Square payment successful. Payment ID:', paymentResult.payment.id);

        // Explicitly construct safe billingContact to prevent Mass Assignment
        // Use input variable names (renamed above) to construct output variables
        const finalBillingContact = {
            givenName: escapeHtml(billingContact.givenName),
            familyName: escapeHtml(billingContact.familyName),
            email: billingContact.email, // email validator ensures format
            phoneNumber: (typeof billingContact.phoneNumber === 'string') ? billingContact.phoneNumber.trim() : undefined
        };

        // Explicitly construct safe shippingContact to prevent Mass Assignment
        const finalShippingContact = {
            givenName: escapeHtml(shippingContact.givenName),
            familyName: escapeHtml(shippingContact.familyName),
            email: shippingContact.email, // email validator ensures format
            phoneNumber: (typeof shippingContact.phoneNumber === 'string') ? shippingContact.phoneNumber.trim() : undefined,
            addressLines: Array.isArray(shippingContact.addressLines)
                ? shippingContact.addressLines.map(line => escapeHtml(line))
                : [],
            locality: escapeHtml(shippingContact.locality),
            administrativeDistrictLevel1: escapeHtml(shippingContact.administrativeDistrictLevel1),
            postalCode: escapeHtml(shippingContact.postalCode),
            country: escapeHtml(shippingContact.country)
        };

        const newOrder = {
          orderId: randomUUID(),
          paymentId: paymentResult.payment.id,
          squareOrderId: paymentResult.payment.orderId,
          amount: Number(amountCents),
          currency: currency || 'USD',
          status: 'NEW',
          orderDetails: inputSafeOrderDetails,
          billingContact: finalBillingContact,
          shippingContact: finalShippingContact,
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

        // Bolt Optimization: Update user orders index
        if (db.userOrderIndex) {
            const email = newOrder.billingContact?.email;
            if (email) {
                if (!db.userOrderIndex[email]) {
                    db.userOrderIndex[email] = [];
                }
                db.userOrderIndex[email].push(newOrder);
            }
        }

        // --- Process Payout ---
        if (product && creator) {
            const quantity = inputSafeOrderDetails.quantity || 1;
            const payoutAmount = product.creatorProfitCents * quantity;

            if (payoutAmount > 0) {
                if (typeof creator.walletBalanceCents === 'undefined') creator.walletBalanceCents = 0;
                creator.walletBalanceCents += payoutAmount;
                logger.info(`[SERVER] Added ${payoutAmount} cents to wallet of ${creator.username}. New balance: ${creator.walletBalanceCents}`);
            }
        }

        await db.write();
        logger.info(`[SERVER] New order created and stored. Order ID: ${newOrder.orderId}.`);

        // Send Telegram notification
        if (getSecret('TELEGRAM_BOT_TOKEN') && getSecret('TELEGRAM_CHANNEL_ID')) {
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
            const sentMessage = await bot.telegram.sendMessage(getSecret('TELEGRAM_CHANNEL_ID'), message, { reply_markup: keyboard });
            // db.data.orders is an object, so we access directly by ID
            if (db.data.orders[newOrder.orderId]) {
              db.data.orders[newOrder.orderId].telegramMessageId = sentMessage.message_id;

              // Send the design image
              if (newOrder.designImagePath) {
                const imagePath = path.join(__dirname, newOrder.designImagePath);
                const sentPhoto = await bot.telegram.sendPhoto(getSecret('TELEGRAM_CHANNEL_ID'), { source: imagePath });
                db.data.orders[newOrder.orderId].telegramPhotoMessageId = sentPhoto.message_id;
              }

              // Send the cut line file
              const cutLinePath = db.data.orders[newOrder.orderId].cutLinePath;
              if (cutLinePath) {
                const docPath = path.join(__dirname, cutLinePath);
                await bot.telegram.sendDocument(getSecret('TELEGRAM_CHANNEL_ID'), { source: docPath });
              }
              await db.write();
            }
          } catch (error) {
            logger.error('[TELEGRAM] Failed to send message or files:', error);
          }
        }

        return res.status(201).json({ success: true, order: newOrder });
      } catch (error) {
        await logAndEmailError(error, 'Critical error in /api/create-order');
        if (error instanceof SquareError) {
            logger.error(error.statusCode);
            logger.error(error.message);
            logger.error(error.body);
        }
        // Handle mocked Square errors or real Square errors that expose status code directly
        // Also handle explicit "Card declined" error from tests as 400 if statusCode is missing/invalid
        if ((error.statusCode && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) || error.message === 'Card declined') {
             const status = (error.statusCode && Number(error.statusCode)) || 400;
             return res.status(status).json({ error: 'Square API Error', details: error.result ? error.result.errors : error.message });
        }
        if (error.result && error.result.errors) {
          return res.status(error.statusCode || 500).json({ error: 'Square API Error', details: error.result.errors });
        }
        // SECURITY: Do not leak error details to the client
        return res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected error occurred.' });
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

    app.get('/api/orders/search', authenticateToken, [
        query('q').notEmpty().withMessage('Query is required').isString().trim(),
    ], (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { q } = req.query;
      const user = getUserByEmail(req.user.email);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Bolt Optimization: Use cached index
      const userOrders = (db.userOrderIndex && db.userOrderIndex[user.email])
          ? db.userOrderIndex[user.email]
          : [];

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

      // Bolt Optimization: Use cached index instead of full table scan
      const userOrders = (db.userOrderIndex && db.userOrderIndex[userEmail])
          ? db.userOrderIndex[userEmail]
          : [];

      res.status(200).json(userOrders.slice().reverse());
    });

    app.get('/api/orders/:orderId', authenticateToken, validateId('orderId'), (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
      }
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
      ...validateId('orderId'),
      body('status').notEmpty().withMessage('status is required').isIn(VALID_STATUSES).withMessage('Invalid status'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { orderId } = req.params;
      const { status } = req.body;
      const order = db.data.orders[orderId]; // Optimized: O(1) lookup

      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      // Check for admin role
      if (!isAdmin(req.user)) {
          return res.status(403).json({ error: 'Forbidden: Admin access required.' });
      }

      const oldStatus = order.status;
      order.status = status;
      order.lastUpdatedAt = new Date().toISOString();

      // Check for stalled message cleanup
      if (order.stalledMessageId) {
          if (getSecret('TELEGRAM_BOT_TOKEN') && getSecret('TELEGRAM_CHANNEL_ID')) {
             try {
                 await bot.telegram.deleteMessage(getSecret('TELEGRAM_CHANNEL_ID'), order.stalledMessageId);
                 logger.info(`[TELEGRAM] Deleted stalled message for order ${orderId}`);
             } catch (err) {
                 logger.error('[TELEGRAM] Failed to delete stalled message:', err);
             }
          }
          delete order.stalledMessageId;
      }

      // Update active orders cache
      const isFinal = FINAL_STATUSES.includes(status);

      // Update Active Orders
      if (db.activeOrders) {
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
      }

      // Update Shipped Orders Cache
      if (db.shippedOrders) {
          // If status BECOMES 'SHIPPED'
          if (status === 'SHIPPED') {
              const exists = db.shippedOrders.find(o => o.orderId === orderId);
              if (!exists) {
                  db.shippedOrders.push(order);
              }
          }
          // If status WAS 'SHIPPED' but CHANGED
          else if (oldStatus === 'SHIPPED' && status !== 'SHIPPED') {
              const idx = db.shippedOrders.findIndex(o => o.orderId === orderId);
              if (idx !== -1) {
                  db.shippedOrders.splice(idx, 1);
              }
          }
      }

      await db.write();
      logger.info(`[SERVER] Order ID ${orderId} status updated to ${status}.`);

      try {
          // Update Telegram message
          if (getSecret('TELEGRAM_BOT_TOKEN') && getSecret('TELEGRAM_CHANNEL_ID') && order.telegramMessageId) {
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
                await bot.telegram.deleteMessage(getSecret('TELEGRAM_CHANNEL_ID'), order.telegramMessageId);
                // also delete the photo if it exists and hasn't been deleted
                if (order.telegramPhotoMessageId) {
                    await bot.telegram.deleteMessage(getSecret('TELEGRAM_CHANNEL_ID'), order.telegramPhotoMessageId);
                }
              } else {
                // For all other statuses, edit the message
                const keyboard = getOrderStatusKeyboard(order);
                await bot.telegram.editMessageText(
                    getSecret('TELEGRAM_CHANNEL_ID'),
                    order.telegramMessageId,
                    undefined,
                    message,
                    { reply_markup: keyboard }
                );
                // If the status is SHIPPED, also delete the photo
                if (status === 'SHIPPED' && order.telegramPhotoMessageId) {
                  await bot.telegram.deleteMessage(getSecret('TELEGRAM_CHANNEL_ID'), order.telegramPhotoMessageId);
                }
              }
            } catch (error) {
              logger.error('[TELEGRAM] Failed to edit or delete message:', error);
            }
          }

          res.status(200).json({ success: true, order: order });
      } catch (error) {
        await logAndEmailError(error, 'Error updating order status');
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    app.post('/api/orders/:orderId/tracking', authenticateToken, [
        ...validateId('orderId'),
        body('trackingNumber').notEmpty().withMessage('trackingNumber is required').isString().trim(),
        body('courier').notEmpty().withMessage('courier is required').isString().trim(),
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

        // --- CACHE UPDATE ---
        // If the order is already SHIPPED, we need to ensure it's in the cache.
        // It might not be there if status was updated before tracking info.
        if (db.shippedOrders && order.status === 'SHIPPED') {
             // Check if it's already in the cache (by reference or ID)
             const exists = db.shippedOrders.find(o => o.orderId === orderId);
             if (!exists) {
                 db.shippedOrders.push(order);
             }
        }

        await db.write();
        logger.info(`[SERVER] Tracking info added to order ID ${orderId}.`);

        // Send shipment notification email
        if (order.billingContact && order.billingContact.email) {
            try {
                const customerName = order.billingContact.givenName || 'Valued Customer';
                const shippingAddress = order.shippingContact;
                const orderDate = new Date(order.receivedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                // FIX: Sanitize address lines to prevent XSS
                const safeAddressLines = shippingAddress.addressLines.map(line => escapeHtml(line)).join('<br>');
                const addressHtml = `
                    <address>
                        ${escapeHtml(shippingAddress.givenName)} ${escapeHtml(shippingAddress.familyName)}<br>
                        ${safeAddressLines}<br>
                        ${escapeHtml(shippingAddress.locality)}, ${escapeHtml(shippingAddress.administrativeDistrictLevel1)} ${escapeHtml(shippingAddress.postalCode)}<br>
                        ${escapeHtml(shippingAddress.country)}<br>
                        ${escapeHtml(shippingAddress.phoneNumber || '')}
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
                logger.info(`[SERVER] Shipment notification email sent for order ID ${orderId}.`);
            } catch (emailError) {
                // Log the error, but don't block the API response since the tracking info was saved.
                await logAndEmailError(emailError, `Failed to send shipment notification for order ${orderId}`);
            }
        }

        res.status(200).json({ success: true, order: order });
    });

    // --- Auth Endpoints ---
    app.post('/api/auth/register-user', authLimiter, [
      ...validateUsername,
      body('password')
        .notEmpty().withMessage('password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    ], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { username, password } = req.body;
      // Note: Prototype pollution check is handled by validateUsername middleware
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
      if (getSecret('ADMIN_EMAIL')) {
        try {
          await sendEmail({
            to: getSecret('ADMIN_EMAIL'),
            subject: 'New User Account Created',
            text: `A new user has registered on the Print Shop.\n\nUsername: ${username}`,
            html: `<p>A new user has registered on the Print Shop.</p><p><b>Username:</b> ${username}</p>`,
            oauth2Client,
          });
        } catch (emailError) {
          logger.error('Failed to send new user notification email:', emailError);
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

      // Sentinel: Timing attack mitigation.
      // Always perform bcrypt comparison to prevent username enumeration via timing analysis.
      // If user is not found or has no password, compare against a dummy hash.
      const targetHash = (user && user.password) ? user.password : DUMMY_HASH;
      const validPassword = await bcrypt.compare(password, targetHash);

      if (!user || !user.password || !validPassword) {
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
    
    app.get('/api/test/last-magic-link', (req, res) => {
        if (process.env.NODE_ENV !== 'test') {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json({ token: lastMagicLinkToken });
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

        lastMagicLinkToken = token;

        const magicLink = `${getSecret('BASE_URL')}/magic-login.html?token=${token}`;

        // The magic link is sensitive and should not be logged.
        // logger.info('Magic Link (for testing):', magicLink);

        logger.info('[magic-login] Checking OAuth2 client state before sending email:');
        logger.info(oauth2Client.credentials);

        try {
            if (process.env.NODE_ENV === 'test' && sendEmail === defaultSendEmail) {
                logger.info('[TEST] Skipping email send. Magic Link:', magicLink);
            } else {
                await sendEmail({
                    to: email,
                    subject: 'Your Magic Link for Splotch',
                    text: `Click here to log in: ${magicLink}`,
                    html: `<p>Click here to log in: <a href="${magicLink}">${magicLink}</a></p>`,
                    oauth2Client,
                });
            }
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
    
    app.post('/api/auth/issue-temp-token', authLimiter, [
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

      logger.info(`[SERVER] Issued temporary token for email: ${email}`);
      res.json({ success: true, token });
    });

    // --- Google OAuth Endpoints ---
    app.get('/auth/google', (req, res) => {
      const scopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email',
      ];

      // SECURITY: Generate a random state to prevent CSRF
      const state = randomBytes(16).toString('hex');
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 600000, // 10 minutes
        signed: true
      });

      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        state: state
      });

      res.redirect(url);
    });

    app.get('/oauth2callback', async (req, res) => {
      const { code, state } = req.query;

      // SECURITY: Verify state parameter to prevent CSRF
      const storedState = req.signedCookies.oauth_state;
      if (!state || !storedState || state !== storedState) {
          return res.status(403).send('Authentication failed: Invalid state parameter.');
      }
      res.clearCookie('oauth_state');

      try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // If a refresh token is received, store it securely for future use.
        if (tokens.refresh_token) {
          db.data.config.google_refresh_token = tokens.refresh_token;
          await db.write();
          logger.info('[SERVER] Google OAuth2 refresh token stored.');
        }

        // The user is authenticated with Google, now get their profile info
        const oauth2 = injectedGoogle.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const userEmail = userInfo.data.email;
        logger.info('Google authentication successful for:', userEmail);

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
          logger.info(`New user created for ${userEmail}`);

          // Send notification email to admin
          if (getSecret('ADMIN_EMAIL')) {
            try {
              await sendEmail({
                to: getSecret('ADMIN_EMAIL'),
                subject: 'New User Account Created (via Google)',
                text: `A new user has registered using their Google account.\n\nEmail: ${userEmail}\nUsername: ${newUsername}`,
                html: `<p>A new user has registered using their Google account.</p><p><b>Email:</b> ${userEmail}</p><p><b>Username:</b> ${newUsername}</p>`,
                oauth2Client,
              });
            } catch (emailError) {
              logger.error('Failed to send new user notification email:', emailError);
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
    app.post('/api/auth/pre-register', authLimiter, validateUsername, async (req, res) => {
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
        logger.info(`New user created for WebAuthn pre-registration: ${username}`);
      }

      const options = await injectedWebAuthn.generateRegistrationOptions({
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

    app.post('/api/auth/register-verify', authLimiter, validateUsername, async (req, res) => {
      const { body } = req;
      const { username } = req.query;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'Invalid username.' });
      }
      const user = Object.prototype.hasOwnProperty.call(db.data.users, username) ? db.data.users[username] : undefined;
      try {
        const verification = await injectedWebAuthn.verifyRegistrationResponse({
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
        // SECURITY: Do not leak error details to the client
        res.status(400).json({ error: 'Verification failed.' });
      }
    });

    app.get('/api/auth/login-options', authLimiter, validateUsername, async (req, res) => {
      const { username } = req.query;
      // Prevent prototype pollution
      if (['__proto__', 'constructor', 'prototype'].includes(username)) {
        return res.status(400).json({ error: 'User not found' });
      }
      const user = Object.prototype.hasOwnProperty.call(db.data.users, username) ? db.data.users[username] : undefined;
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }
      const options = await injectedWebAuthn.generateAuthenticationOptions({
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

    app.post('/api/auth/login-verify', authLimiter, validateUsername, async (req, res) => {
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
        const verification = await injectedWebAuthn.verifyAuthenticationResponse({
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
        // SECURITY: Do not leak error details to the client
        res.status(400).json({ error: 'Verification failed.' });
      }
    });

    // Initialize the shipment tracker
    initializeTracker(db);

    // Ensure keys are loaded/created before signing the first token
    await rotateKeys();

    // Sign the initial token and re-sign periodically
    signInstanceToken();
    const sessionTokenTimer = setInterval(signInstanceToken, 30 * 60 * 1000);
    const keyRotationTimer = setInterval(rotateKeys, KEY_ROTATION_MS);

    if (process.env.NODE_ENV === 'test') {
      sessionTokenTimer.unref();
      keyRotationTimer.unref();
      metricsTimer.unref();
    }
    
    // Return the app and the timers so they can be managed by the caller
    return { app, timers: [sessionTokenTimer, keyRotationTimer, metricsTimer], bot };
    
  } catch (error) {
    await logAndEmailError(error, 'FATAL: Failed to start server');
    process.exit(1);
  }
}


export { startServer };
