// printshop.js

// --- Global Variables ---
let peer; // PeerJS instance for the print shop
let currentShopPeerId = null; // The actual Peer ID being used
const connectedClients = {}; // Store active connections to clients: { clientPeerId: connectionObject }

// --- DOM Elements ---
// These will be assigned in the DOMContentLoaded listener
let peerIdDisplaySpan, peerConnectionMessage, shopPeerIdInput, setPeerIdBtn;
let ordersListDiv, noOrdersMessage, connectionStatusDot;
let squareApiKeyInputEl; // For the API Key input

// --- PeerJS Configuration ---
function initializeShopPeer(requestedId = null) {
    if (peer && !peer.destroyed) {
        console.log("Destroying existing peer instance before creating a new one.");
        try {
            peer.destroy();
        } catch (e) {
            console.error("Error destroying previous peer instance:", e);
        }
    }

    const peerIdToUse = requestedId && requestedId.trim() !== '' ? requestedId.trim() : null;

    try {
        if (typeof Peer === 'undefined') {
            console.error("PeerJS library is not loaded!");
            updateShopPeerStatus("PeerJS library not loaded!", "error", "Error");
            return;
        }

        console.log(`Initializing shop peer with ID: ${peerIdToUse || '(auto-generated)'}`);
        // For a more robust setup, especially if NAT traversal is an issue,
        // you might need to configure STUN/TURN servers here.
        // Example: peer = new Peer(peerIdToUse, { config: {'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }]}});
        peer = new Peer(peerIdToUse, {
            // debug: 3 // Uncomment for verbose PeerJS logging
        });
        updateShopPeerStatus("Initializing...", "pending", "Initializing...");

        peer.on('open', (id) => {
            currentShopPeerId = id;
            console.log('Print Shop PeerJS ID is:', currentShopPeerId);
            updateShopPeerStatus(`Listening for orders. Share this ID with the client app.`, "success", currentShopPeerId);
            if (shopPeerIdInput && !shopPeerIdInput.value && peerIdToUse === null) { // Update input if ID was auto-generated
                shopPeerIdInput.value = currentShopPeerId;
            }
        });

        peer.on('connection', (conn) => {
            console.log(`Incoming connection from client: ${conn.peer}`);
            updateShopPeerStatus(`Connected to client: ${conn.peer.substring(0,8)}...`, "success", currentShopPeerId);
            if(noOrdersMessage) noOrdersMessage.style.display = 'none';

            connectedClients[conn.peer] = conn;

            conn.on('data', (dataFromClient) => {
                console.log(`Received data from ${conn.peer}:`, dataFromClient);
                if (dataFromClient.type === 'newOrder') {
                    displayNewOrder(dataFromClient, conn.peer);
                } else {
                    console.warn("Received unknown data type from client:", dataFromClient);
                }
            });

            conn.on('close', () => {
                handleClientDisconnect(conn.peer);
            });

            conn.on('error', (err) => {
                console.error(`Error with connection from ${conn.peer}:`, err);
                updateShopPeerStatus(`Error with client ${conn.peer.substring(0,8)}...`, "error", currentShopPeerId);
                const orderCard = findOrderCardByClientPeerId(conn.peer); // May need a more robust way to find card
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
             if (err.type === 'unavailable-id' && shopPeerIdInput) {
                message = `Error: Requested Peer ID "${shopPeerIdInput.value}" is already taken. Try another or leave blank.`;
                shopPeerIdInput.value = '';
            } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) {
                message = "Error connecting to PeerJS server. Check network or try again later.";
            }
            updateShopPeerStatus(message, "error", "Error");
            currentShopPeerId = null;
        });

    } catch (e) {
        console.error("Error initializing PeerJS:", e);
        updateShopPeerStatus(`Critical PeerJS Init Error: ${e.message}`, "error", "Error");
    }
}

function handleClientDisconnect(clientPeerId) {
    console.log(`Connection from ${clientPeerId} closed.`);
    updateShopPeerStatus(`Client ${clientPeerId.substring(0,8)}... disconnected.`, "pending", currentShopPeerId);
    delete connectedClients[clientPeerId];

    // Find all order cards associated with this client and update their status
    // This is a simple approach; a more robust system might track orders by a unique order ID
    const orderCards = document.querySelectorAll(`.order-card[data-client-peer-id="${clientPeerId}"]`);
    orderCards.forEach(card => {
        const statusEl = card.querySelector('.client-connection-status');
        if (statusEl) statusEl.textContent = "Client Disconnected";
        card.style.opacity = "0.7";
        const processBtn = card.querySelector('.process-payment-btn');
        if(processBtn && processBtn.textContent.includes("Process")) { // Only disable if not already processed
            processBtn.disabled = true;
            processBtn.title = "Client disconnected, cannot process.";
        }
    });
     if (Object.keys(connectedClients).length === 0 && noOrdersMessage && ordersListDiv.children.length === 1) { // Check if only "no orders" message remains
        // noOrdersMessage.style.display = 'block'; // Or keep orders displayed
    }
}


function updateShopPeerStatus(message, type = "info", peerIdText = "N/A") {
    if (peerIdDisplaySpan) peerIdDisplaySpan.textContent = peerIdText;
    if (peerConnectionMessage) peerConnectionMessage.textContent = message;

    if (connectionStatusDot) {
        connectionStatusDot.classList.remove('status-connected', 'status-disconnected', 'status-pending');
        if (type === "success" && peerIdText !== "Error" && peerIdText !== "Closed" && peerIdText !== "N/A" && peerIdText !== "Initializing...") {
            connectionStatusDot.classList.add('status-connected');
        } else if (type === "error") {
            connectionStatusDot.classList.add('status-disconnected');
        } else { // pending or initializing
            connectionStatusDot.classList.add('status-pending');
        }
    }
}

function displayNewOrder(orderData, clientPeerId) {
    if (!ordersListDiv) {
        console.error("ordersListDiv not found, cannot display order.");
        return;
    }
    if(noOrdersMessage) noOrdersMessage.style.display = 'none';

    // Create a unique ID for the order card itself, incorporating clientPeerId and timestamp
    const orderCardId = `order-card-${clientPeerId}-${orderData.idempotencyKey || Date.now()}`;

    const card = document.createElement('div');
    card.className = 'order-card';
    card.id = orderCardId;
    card.setAttribute('data-client-peer-id', clientPeerId); // Store client peer ID for later reference

    const timestamp = new Date().toLocaleString();
    const formattedAmount = orderData.amountCents ? `$${(orderData.amountCents / 100).toFixed(2)}` : 'N/A';

    card.innerHTML = `
        <h3 class="text-xl text-splotch-red">Order from Client: <span class="font-mono text-sm">${clientPeerId.substring(0,12)}...</span></h3>
        <p class="text-sm text-gray-600">Received: <span class="order-timestamp">${timestamp}</span></p>
        <p class="text-sm text-gray-600 client-connection-status">Client Connected</p> <!-- Status for this specific client connection -->

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 order-details">
            <div>
                <dt>Name:</dt>
                <dd class="customer-name">${orderData.billingContact?.givenName || ''} ${orderData.billingContact?.familyName || ''}</dd>
                <dt>Email:</dt>
                <dd class="customer-email">${orderData.billingContact?.email || 'N/A'}</dd>
                <dt>Phone:</dt>
                <dd class="customer-phone">${orderData.billingContact?.phone || 'N/A'}</dd>
                <dt>Address:</dt>
                <dd>${orderData.billingContact?.addressLines?.join(', ') || 'N/A'}</dd>
                <dd>${orderData.billingContact?.city || ''}, ${orderData.billingContact?.state || ''} ${orderData.billingContact?.postalCode || ''} (${orderData.billingContact?.countryCode || ''})</dd>
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
                <dt>Idempotency Key:</dt>
                <dd class="font-mono text-xs">${orderData.idempotencyKey || 'N/A'}</dd>
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
            <button class="process-payment-btn bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-md" data-order-card-id="${orderCardId}" data-client-peer-id="${clientPeerId}">
                Process Payment & Confirm Order
            </button>
        </div>
        <p class="payment-processing-status mt-2 text-sm italic"></p>
    `;

    ordersListDiv.prepend(card); // Add new orders to the top

    const processBtn = card.querySelector('.process-payment-btn');
    processBtn.addEventListener('click', () => handleProcessPayment(orderData, orderCardId, clientPeerId));
}

async function handleProcessPayment(orderData, orderCardId, clientPeerId) {
    const orderCardElement = document.getElementById(orderCardId);
    const statusEl = orderCardElement ? orderCardElement.querySelector('.payment-processing-status') : null;
    const processBtn = orderCardElement ? orderCardElement.querySelector('.process-payment-btn') : null;

    if (!squareApiKeyInputEl || !squareApiKeyInputEl.value.trim()) {
        const msg = 'Error: Square API Key is missing. Please enter it above.';
        if (statusEl) {
            statusEl.textContent = msg;
            statusEl.classList.remove('text-green-700');
            statusEl.classList.add('text-red-700');
        }
        alert(msg); // Also alert for immediate attention
        return;
    }
    const squareSecretKey = squareApiKeyInputEl.value.trim();

    if (statusEl) statusEl.textContent = 'Processing payment with Square...';
    if (processBtn) processBtn.disabled = true;

    console.log("Attempting to process payment for order:", orderData);
    console.log("Using Square API Key (masked):", "********" + squareSecretKey.slice(-4));

    // --- !!! IMPORTANT: ACTUAL SQUARE API CALL SIMULATION !!! ---
    // In a real application, you would NOT make the Square API call directly from browser JavaScript
    // if this page is hosted in a way that could expose the secret key.
    // This script assumes it's running in a trusted local environment OR it would
    // make a fetch request to a local backend service (e.g., http://localhost:4000/charge)
    // which then uses the Square SDK with the secret key.

    // For this example, we continue with the simulation, but conceptually, the `squareSecretKey`
    // would be used by that secure backend component.

    try {
        // SIMULATION (Replace with actual call to your local secure backend endpoint)
        console.log("Simulating call to a local backend with payment data and API key (conceptually).");
        await new Promise(resolve => setTimeout(resolve, 2500)); // Simulate network delay to backend + Square

        // This object would be the response from your local backend
        const simulatedPaymentResult = {
            success: Math.random() > 0.1, // Simulate 90% success rate
            paymentId: `sp_sim_${Date.now()}`,
            orderId: `so_sim_${Date.now()}`,
            message: "Payment processed successfully (Simulated).",
            // designIpfsHash: "QmSimulatedHashForDesign" // If backend uploads to IPFS and returns hash
        };

        if (!simulatedPaymentResult.success) { // Simulate potential failure from backend/Square
            simulatedPaymentResult.message = "Simulated payment failure at Square.";
        }
        // --- END SIMULATION ---

        if (simulatedPaymentResult.success) {
            if (statusEl) {
                statusEl.textContent = `Success! Payment ID: ${simulatedPaymentResult.paymentId}. Order confirmed.`;
                statusEl.classList.remove('text-red-700');
                statusEl.classList.add('text-green-700');
            }
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
                    designIpfsHash: simulatedPaymentResult.designIpfsHash
                });
            }
        } else {
            throw new Error(simulatedPaymentResult.message || "Simulated payment failure from backend.");
        }

    } catch (error) {
        console.error("Error processing payment:", error);
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message}`;
            statusEl.classList.remove('text-green-700');
            statusEl.classList.add('text-red-700');
        }
        if (processBtn) {
            processBtn.disabled = false;
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
// Ensures the script runs after the full HTML document has been parsed.
document.addEventListener('DOMContentLoaded', () => {
    // Assign DOM elements
    peerIdDisplaySpan = document.getElementById('peer-id-display')?.querySelector('span');
    peerConnectionMessage = document.getElementById('peer-connection-message');
    shopPeerIdInput = document.getElementById('shopPeerIdInput');
    setPeerIdBtn = document.getElementById('setPeerIdBtn');
    ordersListDiv = document.getElementById('orders-list');
    noOrdersMessage = document.getElementById('no-orders-message');
    connectionStatusDot = document.getElementById('connection-status-dot');
    squareApiKeyInputEl = document.getElementById('squareApiKeyInput');

    if (setPeerIdBtn) {
        setPeerIdBtn.addEventListener('click', () => {
            const requestedId = shopPeerIdInput ? shopPeerIdInput.value.trim() : null;
            initializeShopPeer(requestedId);
        });
    } else {
        console.error("Set Peer ID button not found.");
    }
    updateShopPeerStatus("Ready to set Peer ID or auto-generate.", "pending", "Not Set");
});
