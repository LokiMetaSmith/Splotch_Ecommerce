// server.js
const express = require('express');
const squarePackage = require('square');

console.log('--- Square Package Output ---');
console.log(squarePackage); 

// Correct way to get Client and Environment based on your log output
const Client = squarePackage.SquareClient; 
const Environment = squarePackage.SquareEnvironment;

console.log('--- Client from squarePackage.SquareClient ---');
console.log(Client);
console.log('--- Environment from squarePackage.SquareEnvironment ---');
console.log(Environment);

const { randomUUID } = require('crypto');
const cors = require('cors');
require('dotenv').config(); // To load environment variables from a .env file

const app = express();
const port = process.env.PORT || 3000; // Use port from .env or default to 3000

console.log('[SERVER] Initializing Square client...');
if (!process.env.SQUARE_ACCESS_TOKEN) {
    console.error('[SERVER] FATAL: SQUARE_ACCESS_TOKEN is not set in environment variables.');
    // process.exit(1); // Potentially exit if critical
} else {
    console.log('[SERVER] SQUARE_ACCESS_TOKEN is present (value not logged for security).');
}
console.log(`[SERVER] Target Square Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox (default)'}`);


if (!Environment) {
    console.error('[SERVER] FATAL: Square SDK Environment object is undefined. Cannot initialize client.');
    process.exit(1);
}
if (!Client) { // Add a check for Client too
    console.error('[SERVER] FATAL: Square SDK Client object is undefined. Cannot initialize client.');
    process.exit(1);
}
const squareClient = new Client({
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
});
console.log('[SERVER] Square client initialized.');

// --- Middleware ---
// Enable CORS: Configure this carefully for production
// For development, you might allow your specific client origin:
const corsOptions = {
    origin: 'https://lokimetasmith.github.io', // Or where your printshop.html is served
    optionsSuccessStatus: 200 // For legacy browser support
};
app.use(cors(corsOptions));
console.log('[SERVER] CORS middleware enabled with origin:', corsOptions.origin);
app.use(express.json()); // To parse JSON request bodies
console.log('[SERVER] Express JSON middleware enabled.');


// --- API Endpoint for Processing Payments ---
app.post('/api/process-payment', async (req, res) => {
    console.log('[SERVER] Received POST request on /api/process-payment');
    console.log('[SERVER] Request body from print shop:', JSON.stringify(req.body));

    try {
        const { sourceId, idempotencyKey, amountCents, currency /*, other details */ } = req.body;

        if (!sourceId || !amountCents) {
            console.warn('[SERVER] Missing required payment parameters in request body. sourceId:', sourceId, 'amountCents:', amountCents);
            return res.status(400).json({ error: 'Missing required payment parameters.' });
        }

        const paymentPayload = {
            sourceId: sourceId,
            idempotencyKey: idempotencyKey || randomUUID(),
            amountMoney: {
                amount: amountCents, // Square API expects amount as integer in smallest currency unit
                currency: currency || 'USD',
            },
            // locationId: process.env.SQUARE_LOCATION_ID, // Optional: If you need to specify location ID
        };

        console.log('[SERVER] Prepared paymentPayload for Square API:', JSON.stringify(paymentPayload));
        console.log('[SERVER] Calling squareClient.paymentsApi.createPayment...');
        const { result, statusCode } = await squareClient.paymentsApi.createPayment(paymentPayload);

        console.log('[SERVER] Response from Square API. Status Code:', statusCode);
        console.log('[SERVER] Response body from Square API (result):', JSON.stringify(result));

        if (result.errors && result.errors.length > 0) {
            console.warn('[SERVER] Square API returned errors:', JSON.stringify(result.errors));
            return res.status(statusCode || 400).json({ error: 'Square API Error', details: result.errors });
        }

        const responseToPrintShop = { success: true, payment: result.payment };
        console.log('[SERVER] Sending successful response to print shop:', JSON.stringify(responseToPrintShop));
        return res.status(200).json(responseToPrintShop);

    } catch (error) {
        console.error('[SERVER] Error processing payment in /api/process-payment:', error);
        // Check if it's a Square API error with a response body (from Square SDK structure)
        if (error.response && error.response.data && error.response.data.errors) { // Error from Square SDK
            console.error('[SERVER] Square API error details:', JSON.stringify(error.response.data.errors));
            return res.status(error.statusCode || 500).json({ error: 'Square API Error', details: error.response.data.errors });
        } else if (error.errors && error.statusCode) { // Another common structure for Square SDK errors
             console.error('[SERVER] Square API error (alternative structure):', JSON.stringify(error.errors));
            return res.status(error.statusCode).json({ error: 'Square API Error', details: error.errors });
        }
        // Generic server error
        const errorResponseToPrintShop = { error: 'Internal Server Error', message: error.message };
        console.log('[SERVER] Sending internal server error response to print shop:', JSON.stringify(errorResponseToPrintShop));
        return res.status(500).json(errorResponseToPrintShop);
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`[SERVER] Server listening at http://localhost:${port}`);
    // The actual environment used by the SDK was determined by process.env.SQUARE_ENVIRONMENT
    // and logged during client initialization. Accessing it via squareClient.config.environment was problematic.
    console.log(`[SERVER] Square client was initialized using environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox (default)'}`);
    // SQUARE_ACCESS_TOKEN is sensitive, so avoid logging its direct value.
    // We already logged its presence earlier.
});