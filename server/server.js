import express from 'express';
import square from 'square';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Import the whole package into one variable
const squarePackage = require('square');
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

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// --- Ensure upload directory exists ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// --- Database Setup ---
const defaultData = { orders: [], users: {}, credentials: {} };
const db = await JSONFilePreset('db.json', defaultData);
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

// --- THE FINAL DIAGNOSTIC LINE ---
console.log('[FINAL DIAGNOSTIC] Keys in square package:', Object.keys(squarePackage));

// Now, attempt to get Client and Environment from it
const { SquareClient, SquareEnvironment } = squarePackage;
console.log('[SERVER] Initializing Square client...');
if (!process.env.SQUARE_ACCESS_TOKEN) {
    console.error('[SERVER] FATAL: SQUARE_ACCESS_TOKEN is not set in environment variables.');
    process.exit(1);
}
// Add this line for diagnosis:
console.log('[DIAGNOSTIC] Is Environment defined?', SquareEnvironment);
const squareClient = new SquareClient({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,

});
console.log('[SERVER] Square client initialized.');

// --- Middleware ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
});

app.use(limiter);

// --- CORS Configuration ---
const allowedOrigins = [
    'https://lokimetasmith.github.io',
    // Add other allowed origins here if needed
];

// Allow localhost for development using a regular expression
if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push(/http:\/\/localhost:\d+/);
}

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        // Check if the origin is in the allowed list
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
    credentials: true, // Important for cookies
    optionsSuccessStatus: 200, // For legacy browser support
};

app.use(cors(corsOptions));
app.use(express.json()); // To parse JSON request bodies (for APIs without file uploads)
app.use(cookieParser());
app.use(csrf({ cookie: true }));
app.use('/uploads', express.static(uploadDir)); // Serve uploaded files statically
console.log('[SERVER] Middleware (CORS, JSON, static file serving) enabled.');

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

app.post('/api/create-order', authenticateToken, upload.single('designImage'), [
    body('sourceId').notEmpty().withMessage('sourceId is required'),
    body('amountCents').isInt({ gt: 0 }).withMessage('amountCents must be a positive integer'),
    body('currency').optional().isAlpha().withMessage('currency must be alphabetic'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    console.log('[SERVER] Received POST request on /api/create-order');
    console.log('[SERVER] Request body:', req.body);
    console.log('[SERVER] Request file:', req.file);

    try {
        const { sourceId, amountCents, currency, ...orderDetails } = req.body;

        // 1. Process Payment
        const paymentPayload = {
            sourceId: sourceId,
            idempotencyKey: randomUUID(),
            amountMoney: {
                amount: BigInt(amountCents), // Use BigInt for currency
                currency: currency || 'USD',
            },
        };
        console.log('[SERVER] Calling Square CreatePayment API with payload:', JSON.stringify(paymentPayload));
        const { result: paymentResult, statusCode } = await squareClient.paymentsApi.createPayment(paymentPayload);

        if (statusCode >= 300 || (paymentResult.errors && paymentResult.errors.length > 0)) {
            console.error('[SERVER] Square API returned an error:', JSON.stringify(paymentResult.errors));
            return res.status(statusCode || 400).json({ error: 'Square API Error', details: paymentResult.errors });
        }
        console.log('[SERVER] Square payment successful. Payment ID:', paymentResult.payment.id);

        // 2. If payment is successful, create and store the order
        const newOrder = {
            orderId: randomUUID(),
            paymentId: paymentResult.payment.id,
            squareOrderId: paymentResult.payment.orderId,
            amount: Number(amountCents), // Store as number
            currency: currency || 'USD',
            status: 'NEW', // Initial status
            orderDetails: JSON.parse(orderDetails.orderDetails), // Assuming orderDetails is a JSON string
            billingContact: JSON.parse(orderDetails.billingContact), // Assuming billingContact is a JSON string
            designImagePath: `/uploads/${req.file.filename}`, // Path to access the file
            receivedAt: new Date().toISOString(),
        };

        db.data.orders.push(newOrder);
        await db.write();
        console.log(`[SERVER] New order created and stored. Order ID: ${newOrder.orderId}. Total orders in DB: ${db.data.orders.length}`);

        // TODO: In a real app, you would push a notification to connected print shops via WebSockets here.

        return res.status(201).json({ success: true, order: newOrder });

    } catch (error) {
        console.error('[SERVER] Critical error in /api/create-order:', error);
        if (error.response && error.response.data) { // Square SDK specific error wrapping
            return res.status(error.statusCode || 500).json({ error: 'Square API Error', details: error.response.data.errors });
        }
        return res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});


/**
 * Endpoint for the print shop to fetch all orders.
 * In a real application, you'd add filtering (e.g., by status) and pagination.
 */
app.get('/api/orders', authenticateToken, (req, res) => {
    const user = Object.values(db.data.users).find(u => u.email === req.user.email);

    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }

    const userOrders = db.data.orders.filter(order => order.billingContact.email === user.email);
    console.log(`[SERVER] Received GET request on /api/orders. Returning ${userOrders.length} orders.`);
    // Return orders in reverse chronological order (newest first)
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

/**
 * Endpoint for the print shop to update an order's status.
 */
app.post('/api/orders/:orderId/status', authenticateToken, [
    body('status').notEmpty().withMessage('status is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { orderId } = req.params;
    const { status } = req.body;
    console.log(`[SERVER] Received status update request for Order ID: ${orderId}. New status: ${status}`);

    const order = db.data.orders.find(o => o.orderId === orderId);

    if (!order) {
        console.warn(`[SERVER] Status update failed: Order ID ${orderId} not found.`);
        return res.status(404).json({ error: 'Order not found.' });
    }

    order.status = status;
    order.lastUpdatedAt = new Date().toISOString();
    await db.write();
    console.log(`[SERVER] Order ID ${orderId} status updated to ${status}.`);

    // TODO: In a real app, you might push a notification to the client here via WebSockets.

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
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    // Find if user exists, or create a temporary one.
    // This logic is similar to magic-login but returns the token directly.
    let user = Object.values(db.data.users).find(u => u.email === email);

    if (!user) {
        user = {
            id: randomUUID(),
            email: email, // Use email here
            credentials: [],
        };
        // Use email as the key for the user object, assuming emails are unique identifiers for this flow
        db.data.users[email] = user;
        await db.write();
        console.log(`[SERVER] Created temporary user profile for ${email}`);
    }

    // Issue a short-lived token (e.g., 5 minutes)
    const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '5m' });

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
        // For passwordless login, we can create a new user if one doesn't exist
        user = {
            id: randomUUID(),
            email: email,
            credentials: [],
        };
        // Corrected: Use email as the key for the user object
        db.data.users[email] = user;
        await db.write();
    }

    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const magicLink = `${process.env.BASE_URL}/magic-login?token=${token}`;

    console.log('Magic Link:', magicLink);

    res.json({ success: true, message: 'Check your email for a magic link to log in.' });
});

app.get('/api/auth/register-options', (req, res) => {
    const { username } = req.query;

    if (!username || !db.data.users[username]) {
        return res.status(400).json({ error: 'User not found' });
    }

    const options = generateRegistrationOptions({
        rpID: process.env.RP_ID,
        rpName: 'Print Shop',
        userName: username,
        // Don't prompt users for additional information about the authenticator
        authenticatorSelection: {
            userVerification: 'preferred',
        },
    });

    // Store the challenge
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
            // Add the credential to the user's list of credentials
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

    // Store the challenge
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


// --- Start Server ---
app.listen(port, () => {
    console.log(`[SERVER] Server listening at http://localhost:${port}`);
    console.log(`[SERVER] Uploads will be saved to: ${uploadDir}`);
    console.log(`[SERVER] Static files served from /uploads`);
    console.log(`[SERVER] Square client was initialized using environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox (default)'}`);
});