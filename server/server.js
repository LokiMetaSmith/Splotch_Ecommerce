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

if (!Environment) {
    console.error('FATAL: Square SDK Environment object is undefined. Cannot initialize client.');
    process.exit(1);
}
if (!Client) { // Add a check for Client too
    console.error('FATAL: Square SDK Client object is undefined. Cannot initialize client.');
    process.exit(1);
}
const squareClient = new Client({
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
});
// --- Middleware ---
// Enable CORS: Configure this carefully for production
// For development, you might allow your specific client origin:
const corsOptions = {
    origin: 'https://lokimetasmith.github.io', // Or where your printshop.html is served
    optionsSuccessStatus: 200 // For legacy browser support
};
app.use(cors(corsOptions));
app.use(express.json()); // To parse JSON request bodies


// --- API Endpoint for Processing Payments ---
app.post('/api/process-payment', async (req, res) => {
    try {
        const { sourceId, idempotencyKey, amountCents, currency /*, other details */ } = req.body;

        if (!sourceId || !amountCents) {
            return res.status(400).json({ error: 'Missing required payment parameters.' });
        }

        const paymentPayload = {
            sourceId: sourceId,
            idempotencyKey: idempotencyKey || randomUUID(),
            amountMoney: {
                amount: amountCents,
                currency: currency || 'USD',
            },
            // locationId: process.env.SQUARE_LOCATION_ID, // Optional
        };

        console.log('Received payment request:', paymentPayload);
        const { result, statusCode } = await squareClient.paymentsApi.createPayment(paymentPayload);
        console.log('Square API Response:', result);

        if (result.errors && result.errors.length > 0) {
            return res.status(statusCode || 400).json({ error: 'Square API Error', details: result.errors });
        }

        return res.status(200).json({ success: true, payment: result.payment });

    } catch (error) {
        console.error('Error processing payment:', error);
        // Check if it's a Square API error with a response body
        if (error.response && error.response.data) {
            return res.status(error.statusCode || 500).json({ error: 'Square API Error', details: error.response.data.errors });
        }
        return res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    console.log(`Square Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox (default)'}`);
});