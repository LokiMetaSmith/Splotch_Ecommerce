// server.js
const express = require('express');
const { SquareClient, Environment } = require('square');
const { randomUUID } = require('crypto');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- Ensure upload directory exists ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// --- In-Memory "Database" ---
// WARNING: This is for demonstration purposes. Data will be lost on server restart.
// For production, replace this with a real database (e.g., SQLite, PostgreSQL, MongoDB).
const ordersDB = [];
console.log('[SERVER] In-memory database initialized.');

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
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
});
console.log('[SERVER] Square client initialized.');

// --- Middleware ---
app.use(cors({ origin: 'https://lokimetasmith.github.io', optionsSuccessStatus: 200 }));
app.use(express.json()); // To parse JSON request bodies (for APIs without file uploads)
app.use('/uploads', express.static(uploadDir)); // Serve uploaded files statically
console.log('[SERVER] Middleware (CORS, JSON, static file serving) enabled.');


// --- API Endpoints ---

app.post('/api/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
    }

    res.json({ success: true, filePath: `/uploads/${req.file.filename}` });
});

/**
 * Endpoint to create a new order.
 * Expects a `multipart/form-data` request with:
 * - 'designImage': The image file for the sticker.
 * - All other order details as form fields (e.g., sourceId, amountCents, quantity, material, etc.).
 */
app.post('/api/create-order', upload.single('designImage'), async (req, res) => {
    console.log('[SERVER] Received POST request on /api/create-order');
    console.log('[SERVER] Request body:', req.body);
    console.log('[SERVER] Request file:', req.file);

    try {
        const { sourceId, amountCents, currency, ...orderDetails } = req.body;

        if (!sourceId || !amountCents || !req.file) {
            console.warn('[SERVER] Missing required parameters: sourceId, amountCents, or designImage.');
            return res.status(400).json({ error: 'Missing required parameters (sourceId, amountCents, designImage).' });
        }

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

        ordersDB.push(newOrder);
        console.log(`[SERVER] New order created and stored. Order ID: ${newOrder.orderId}. Total orders in DB: ${ordersDB.length}`);

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
app.get('/api/orders', (req, res) => {
    console.log(`[SERVER] Received GET request on /api/orders. Returning ${ordersDB.length} orders.`);
    // Return orders in reverse chronological order (newest first)
    res.status(200).json(ordersDB.slice().reverse());
});

/**
 * Endpoint for the print shop to update an order's status.
 */
app.post('/api/orders/:orderId/status', (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;
    console.log(`[SERVER] Received status update request for Order ID: ${orderId}. New status: ${status}`);

    if (!status) {
        return res.status(400).json({ error: 'Status is required.' });
    }

    const order = ordersDB.find(o => o.orderId === orderId);

    if (!order) {
        console.warn(`[SERVER] Status update failed: Order ID ${orderId} not found.`);
        return res.status(404).json({ error: 'Order not found.' });
    }

    order.status = status;
    order.lastUpdatedAt = new Date().toISOString();
    console.log(`[SERVER] Order ID ${orderId} status updated to ${status}.`);

    // TODO: In a real app, you might push a notification to the client here via WebSockets.

    res.status(200).json({ success: true, order: order });
});


// --- Start Server ---
app.listen(port, () => {
    console.log(`[SERVER] Server listening at http://localhost:${port}`);
    console.log(`[SERVER] Uploads will be saved to: ${uploadDir}`);
    console.log(`[SERVER] Static files served from /uploads`);
    console.log(`[SERVER] Square client was initialized using environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox (default)'}`);
});