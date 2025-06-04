// printshop.js

// --- Global Variables ---
let peer; // PeerJS instance for the print shop
let currentShopPeerId = null; // The actual Peer ID being used
const connectedClients = {}; // Store active connections to clients

// --- DOM Elements ---
let peerIdDisplaySpan, peerConnectionMessage, shopPeerIdInput, setPeerIdBtn;
let ordersListDiv, noOrdersMessage, connectionStatusDot;

// --- PeerJS Configuration ---
// This function initializes or re-initializes the PeerJS instance for the shop
function initializeShopPeer(requestedId = null) {
    if (peer && !peer.destroyed) {
        console.log("Destroying existing peer instance before creating a new one.");
        peer.destroy(); // Ensure previous instance is cleaned up
    }

    const peerIdToUse = requestedId || null; // Let PeerJS generate if null/empty

    try {
        if (typeof Peer === 'undefined') {
            console.error("PeerJS library is not loaded!");
            updateShopPeerStatus("PeerJS library not loaded!", "error", "Error");
            return;
        }

        console.log(`Initializing shop peer with ID: ${peerIdToUse || '(auto-generated)'}`);
        peer = new Peer(peerIdToUse, {
            // You might configure STUN/TURN servers here for more robust NAT traversal
            // key: 'YOUR_PEERJS_SERVER_API_KEY', // If using a hosted PeerServer that requires an API key
            // debug: 3 // For verbose logging from PeerJS
        });
        updateShopPeerStatus("Initializing...", "pending", "Initializing...");

        peer.on('open', (id) => {
            currentShopPeerId = id;
            console.log('Print Shop PeerJS ID is:', currentShopPeerId);
            updateShopPeerStatus(`Listening for orders. Share this ID with the client app.`, "success", currentShopPeerId);
            if (shopPeerIdInput && !shopPeerIdInput.value) { // Update input if it was blank and ID was auto-generated
                shopPeerIdInput.value = currentShopPeerId;
            }
        });

        peer.on('connection', (conn) => {
            console.log(`Incoming connection from client: ${conn.peer}`);
            updateShopPeerStatus(`Connected to client: ${conn.peer.substring(0,8)}...`, "success", currentShopPeerId);
            noOrdersMessage.style.display = 'none'; // Hide "no orders" message

            connectedClients[conn.peer] = conn; // Store the connection

            conn.on('data', (dataFromClient) => {
                console.log(`Received data from ${conn.peer}:`, dataFromClient);
                if (dataFromClient.type === 'newOrder') {
                    displayNewOrder(dataFromClient, conn.peer);
                } else {
                    console.warn("Received unknown data type from client:", dataFromClient);
                }
            });

            conn.on('close', () => {
                console.log(`Connection from ${conn.peer} closed.`);
                updateShopPeerStatus(`Client ${conn.peer.substring(0,8)}... disconnected.`, "pending", currentShopPeerId);
                delete connectedClients[conn.peer];
                // Optionally remove or mark the order card as disconnected
                const orderCard = document.getElementById(`order-${conn.peer}`);
                if (orderCard) {
                    const statusEl = orderCard.querySelector('.client-connection-status');
                    if(statusEl) statusEl.textContent = "Client Disconnected";
                    orderCard.style.opacity = "0.7";
                }
            });

            conn.on('error', (err) => {
                console.error(`Error with connection from ${conn.peer}:`, err);
                updateShopPeerStatus(`Error with client ${conn.peer.substring(0,8)}...`, "error", currentShopPeerId);
                 // Optionally update the specific order card
                const orderCard = document.getElementById(`order-${conn.peer}`);
                if (orderCard) {
                    const statusEl = orderCard.querySelector('.payment-processing-status');
                    if(statusEl) statusEl.textContent = `Connection Error: ${err.message}`;
                }
            });
        });

        peer.on('disconnected', () => {
            console.warn('Shop peer disconnected from PeerJS server. Attempting to reconnect...');
            updateShopPeerStatus("Disconnected from PeerJS server. Reconnecting...", "pending", "Reconnecting...");
            if (peer && !peer.destroyed) {
                try { peer.reconnect(); } catch(e) { console.error("Error reconnecting peer:", e); }
            }
        });

        peer.on('close', () => {
            console.log('Shop peer instance closed.');
            updateShopPeerStatus("Peer connection closed. Please Set/Refresh ID.", "error", "Closed");
            currentShopPeerId = null;
        });

        peer.on('error', (err) => {
            console.error('Shop PeerJS general error:', err);
            let message = `Error: ${err.message || err.type || 'Unknown PeerJS error'}`;
             if (err.type === 'unavailable-id') {
                message = `Error: Requested Peer ID "${shopPeerIdInput.value}" is already taken. Try another or leave blank.`;
                if(shopPeerIdInput) shopPeerIdInput.value = ''; // Clear the problematic ID
            } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                message = "Error connecting to PeerJS server. Check network or try again later.";
            }
            updateShopPeerStatus(message, "error", "Error");
            currentShopPeerId = null; // Reset as the connection failed
        });

    } catch (e) {
        console.error("Error initializing PeerJS:", e);
        updateShopPeerStatus(`Critical PeerJS Init Error: ${e.message}`, "error", "Error");
    }
}

function updateShopPeerStatus(message, type = "info", peerIdText = "N/A") {
    if (peerIdDisplaySpan) peerIdDisplaySpan.textContent = peerIdText;
    if (peerConnectionMessage) peerConnectionMessage.textContent = message;

    if (connectionStatusDot) {
        connectionStatusDot.classList.remove('status-connected', 'status-disconnected', 'status-pending');
        if (type === "success") connectionStatusDot.classList.add('status-connected');
        else if (type === "error") connectionStatusDot.classList.add('status-disconnected');
        else connectionStatusDot.classList.add('status-pending');
    }
}

function displayNewOrder(orderData, clientPeerId) {
    if (!ordersListDiv) return;
    noOrdersMessage.style.display = 'none';

    const orderId = `order-${clientPeerId}-${Date.now()}`; // Unique ID for the card

    const card = document.createElement('div');
    card.className = 'order-card';
    card.id = orderId;

    const timestamp = new Date().toLocaleString();
    const formattedAmount = orderData.amountCents ? `$${(orderData.amountCents / 100).toFixed(2)}` : 'N/A';

    card.innerHTML = `
        <h3 class="text-xl text-splotch-red">Order from Client: <span class="font-mono text-sm">${clientPeerId.substring(0,12)}...</span></h3>
        <p class="text-sm text-gray-600">Received: <span class="order-timestamp">${timestamp}</span></p>
        <p class="text-sm text-gray-600 client-connection-status">Client Connected</p>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 order-details">
            <div>
                <dt>Customer:</dt>
                <dd class="customer-name">${orderData.billingContact?.givenName || ''} ${orderData.billingContact?.familyName || ''}</dd>
                <dt>Email:</dt>
                <dd class="customer-email">${orderData.billingContact?.email || 'N/A'}</dd>
                <dt>Phone:</dt>
                <dd class="customer-phone">${orderData.billingContact?.phone || 'N/A'}</dd>
            </div>
            <div>
                <dt>Quantity:</dt>
                <dd class="order-quantity">${orderData.orderDetails?.quantity || 'N/A'}</dd>
                <dt>Material:</dt>
                <dd class="order-material">${orderData.orderDetails?.material || 'N/A'}</dd>
                <dt>Amount:</dt>
                <dd class="order-amount">${formattedAmount}</dd>
                <dt>Cut Line File:</dt>
                <dd class="order-cutfile">${orderData.orderDetails?.cutLineFileName || 'None provided'}</dd>
            </div>
        </div>

        ${orderData.designDataUrl ? `
        <div class="mt-2">
            <dt>Sticker Design Preview:</dt>
            <img src="${orderData.designDataUrl}" alt="Sticker Design" class="sticker-design">
        </div>` : '<p class="mt-2 text-sm text-gray-500">No design image provided by client.</p>'}

        <div class="mt-2">
            <dt>Payment Nonce (Source ID):</dt>
            <dd class="payment-nonce font-mono text-xs break-all">${orderData.sourceId || 'N/A'}</dd>
        </div>
        <div class="mt-4">
            <button class="process-payment-btn bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-md" data-order-id="${orderId}" data-client-peer-id="${clientPeerId}">
                Process Payment & Confirm Order
            </button>
        </div>
        <p class="payment-processing-status mt-2 text-sm italic"></p>
    `;

    ordersListDiv.prepend(card); // Add new orders to the top

    const processBtn = card.querySelector('.process-payment-btn');
    processBtn.addEventListener('click', () => handleProcessPayment(orderData, orderId, clientPeerId));
}

async function handleProcessPayment(orderData, orderCardId, clientPeerId) {
    const orderCardElement = document.getElementById(orderCardId);
    const statusEl = orderCardElement ? orderCardElement.querySelector('.payment-processing-status') : null;
    const processBtn = orderCardElement ? orderCardElement.querySelector('.process-payment-btn') : null;

    if (statusEl) statusEl.textContent = 'Processing payment with Square...';
    if (processBtn) processBtn.disabled = true;

    console.log("Attempting to process payment for order:", orderData);

    // --- !!! IMPORTANT SECURITY NOTE !!! ---
    // This is where the ACTUAL Square API call using your SECRET KEY would happen.
    // This should NOT be done directly in client-side JavaScript if this page is hosted publicly.
    // This `printshop.js` is assumed to be running in a trusted environment (e.g., local machine at the print shop,
    // or as part of an Electron app where it can securely access a Node.js backend/main process).

    // SIMULATING backend call for now.
    // In a real scenario, you'd send `orderData.sourceId`, `orderData.amountCents`, etc.,
    // to a local backend endpoint (e.g., http://localhost:YOUR_BACKEND_PORT/charge)
    // which then uses the Square Node.js SDK and your secret key.

    try {
        // const backendResponse = await fetch('http://localhost:YOUR_BACKEND_PORT/charge-square-payment', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({
        //         sourceId: orderData.sourceId,
        //         amount: orderData.amountCents, // Backend expects amount in cents
        //         currency: orderData.currency,
        //         idempotencyKey: orderData.idempotencyKey,
        //         orderDetails: orderData.orderDetails, // Pass along for logging/order creation
        //         billingContact: orderData.billingContact
        //     })
        // });
        // if (!backendResponse.ok) {
        //     const errData = await backendResponse.json();
        //     throw new Error(errData.message || `Payment processing failed with status ${backendResponse.status}`);
        // }
        // const paymentResult = await backendResponse.json();
        // console.log("Payment result from (simulated) backend:", paymentResult);


        // --- SIMULATION ---
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate network delay
        const simulatedPaymentResult = {
            success: true, // Math.random() > 0.2, // Simulate occasional failure
            paymentId: `sim_pay_${Date.now()}`,
            orderId: `sim_ord_${Date.now()}`,
            message: "Payment processed successfully (Simulated).",
            // designIpfsHash: "QmSimulatedHashForDesign" // If backend uploads to IPFS
        };
        // --- END SIMULATION ---

        if (simulatedPaymentResult.success) {
            if (statusEl) statusEl.textContent = `Success! Payment ID: ${simulatedPaymentResult.paymentId}. Order confirmed.`;
            if (statusEl) statusEl.classList.add('text-green-700');
            if (processBtn) processBtn.textContent = "Payment Processed";

            // Send confirmation back to the client
            const clientConn = connectedClients[clientPeerId];
            if (clientConn && clientConn.open) {
                clientConn.send({
                    type: 'paymentResponse',
                    success: true,
                    paymentId: simulatedPaymentResult.paymentId,
                    orderId: simulatedPaymentResult.orderId,
                    message: 'Your payment was successful and the order is confirmed!',
                    designIpfsHash: simulatedPaymentResult.designIpfsHash // If applicable
                });
            }
        } else {
            throw new Error(simulatedPaymentResult.message || "Simulated payment failure.");
        }

    } catch (error) {
        console.error("Error processing payment:", error);
        if (statusEl) statusEl.textContent = `Error: ${error.message}`;
        if (statusEl) statusEl.classList.add('text-red-700');
        if (processBtn) {
            processBtn.disabled = false; // Re-enable button on failure
            processBtn.textContent = "Retry Payment";
        }

        // Send error back to the client
        const clientConn = connectedClients[clientPeerId];
        if (clientConn && clientConn.open) {
            clientConn.send({
                type: 'paymentResponse',
                success: false,
                message: `Payment processing failed: ${error.message}`
            });
        }
    }
}


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    // Assign DOM elements
    peerIdDisplaySpan = document.getElementById('peer-id-display').querySelector('span');
    peerConnectionMessage = document.getElementById('peer-connection-message');
    shopPeerIdInput = document.getElementById('shopPeerIdInput');
    setPeerIdBtn = document.getElementById('setPeerIdBtn');
    ordersListDiv = document.getElementById('orders-list');
    noOrdersMessage = document.getElementById('no-orders-message');
    connectionStatusDot = document.getElementById('connection-status-dot');

    if (setPeerIdBtn) {
        setPeerIdBtn.addEventListener('click', () => {
            const requestedId = shopPeerIdInput.value.trim();
            initializeShopPeer(requestedId || null); // Pass null if empty to auto-generate
        });
    } else {
        console.error("Set Peer ID button not found.");
    }

    // Initial PeerJS setup when the page loads
    // Allow user to set ID first if they want, or it will auto-generate.
    // initializeShopPeer(); // Or call it after a button click if you prefer manual start
    updateShopPeerStatus("Ready to set Peer ID or auto-generate.", "pending", "Not Set");
});
