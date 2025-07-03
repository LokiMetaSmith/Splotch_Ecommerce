// printshop.js

// --- Global Variables ---
let peer; // PeerJS instance for the print shop
let currentShopPeerId = null; // The actual Peer ID being used
const connectedClients = {}; // Store active connections to clients: { clientPeerId: connectionObject }
const incomingImageChunks = {}; // Store chunks for reassembly: { dataId: { chunks: [], receivedChunks: 0, totalChunks: -1, clientPeerId: '' } }

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
                const dataId = dataFromClient.idempotencyKey || (dataFromClient.orderDetails ? dataFromClient.orderDetails.idempotencyKey : null) || dataFromClient.dataId;

                if (dataFromClient.type === 'newOrder') {
                    if (dataFromClient.designDataUrlComingInChunks) {
                        if (!dataId) {
                            console.error("Received newOrder with designDataUrlComingInChunks but no idempotencyKey!", dataFromClient);
                            // Send error back to client?
                            return;
                        }
                        incomingImageChunks[dataId] = {
                            orderData: dataFromClient, // Store the initial order data
                            chunks: [],
                            receivedChunks: 0,
                            totalChunks: -1, // Will be set by the first chunk
                            clientPeerId: conn.peer,
                            status: 'waiting_chunks'
                        };
                        console.log(`New order ${dataId} from ${conn.peer} - expecting image data in chunks.`);
                        // Display a placeholder card
                        displayNewOrder(dataFromClient, conn.peer);
                        updateOrderStatusInUI(dataId, `Receiving image for order... 0%`);
                    } else {
                        // Process order directly if image is included or not expected in chunks
                        displayNewOrder(dataFromClient, conn.peer);
                    }
                } else if (dataFromClient.type === 'imageDataChunk') {
                    if (!dataId) {
                        console.error("Received imageDataChunk but no dataId!", dataFromClient);
                        return;
                    }
                    handleImageDataChunk(dataFromClient, conn.peer);
                } else if (dataFromClient.type === 'imageDataAbort') {
                    handleImageDataAbort(dataFromClient, conn.peer);
                } else {
                    console.warn(`Received unknown data type '${dataFromClient.type}' from client ${conn.peer}:`, dataFromClient);
                }
            });

            conn.on('close', () => {
                handleClientDisconnect(conn.peer);
            });

            conn.on('error', (err) => {
                console.error(`Error with connection from ${conn.peer}:`, err);
                updateShopPeerStatus(`Error with client ${conn.peer.substring(0,8)}...`, "error", currentShopPeerId);
                const orderCard = findOrderCardByClientPeerId(conn.peer);
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

    const orderCards = document.querySelectorAll(`.order-card[data-client-peer-id="${clientPeerId}"]`);
    orderCards.forEach(card => {
        const statusEl = card.querySelector('.client-connection-status');
        if (statusEl) statusEl.textContent = "Client Disconnected";
        card.style.opacity = "0.7";
        const processBtn = card.querySelector('.process-payment-btn');
        if(processBtn && processBtn.textContent.includes("Process")) {
            processBtn.disabled = true;
            processBtn.title = "Client disconnected, cannot process.";
        }
    });
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
        } else {
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

    // Use idempotencyKey as the primary ID for the card to allow updates
    const orderCardId = `order-card-${orderData.idempotencyKey || clientPeerId + '-' + Date.now()}`;
    let card = document.getElementById(orderCardId);
    let isNewCard = !card;

    if (isNewCard) {
        card = document.createElement('div');
        card.className = 'order-card';
        card.id = orderCardId;
        card.setAttribute('data-client-peer-id', clientPeerId);
    }

    const timestamp = new Date().toLocaleString();
    // Determine if we are waiting for chunks (used to decide if image placeholder is shown)
    // This function is now also called when chunks are complete, so orderData.designDataUrlComingInChunks might be initially true
    // but by the time it's re-called, designDataUrl is populated.
    const isWaitingForChunks = orderData.designDataUrlComingInChunks && !orderData.designDataUrl;
    const formattedAmount = orderData.amountCents ? `$${(orderData.amountCents / 100).toFixed(2)}` : 'N/A';

    card.innerHTML = `
        <h3 class="text-xl text-splotch-red">Order from Client: <span class="font-mono text-sm">${clientPeerId.substring(0,12)}...</span></h3>
        <p class="text-sm text-gray-600">Received: <span class="order-timestamp">${timestamp}</span></p>
        <p class="text-sm text-gray-600 client-connection-status">Client Connected</p>
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
        <div class="mt-2 design-image-container">
            ${isWaitingForChunks ? '<p class="text-sm text-blue-500"><i>Receiving design image...</i></p>' :
              (orderData.designDataUrl ?
              `<div><dt>Sticker Design Preview:</dt><img src="${orderData.designDataUrl}" alt="Sticker Design" class="sticker-design"></div>` :
              '<p class="text-sm text-gray-500">No design image provided by client.</p>')
            }
        </div>
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

    if (isNewCard) { // Only prepend if it's a brand new card
        ordersListDiv.prepend(card);
    }

    // Ensure button event listener is attached/reattached if card is being updated
    const processBtn = card.querySelector('.process-payment-btn');
    // Remove existing listener to prevent duplicates if card is updated, then add
    // A more robust way would be to ensure this function is only called once per button,
    // or use a unique ID for the event listener if that's feasible.
    // For simplicity, we'll rely on the fact that innerHTML wipes old listeners on direct children.
    // However, if the button itself is not replaced, its listeners persist.
    // A simple way: store a flag on the button.
    if (!processBtn.hasAttribute('data-listener-attached')) {
        processBtn.addEventListener('click', () => handleProcessPayment(orderData, orderCardId, clientPeerId));
        processBtn.setAttribute('data-listener-attached', 'true');
    }
    // Disable button if waiting for chunks and it's not yet re-enabled by full image load
    if (isWaitingForChunks) {
        processBtn.disabled = true;
        processBtn.title = "Waiting for complete image data...";
    } else if (orderData.designDataUrl) { // Re-enable if image is now present
        processBtn.disabled = false;
        processBtn.title = "Process Payment & Confirm Order";
    }

}

function updateOrderStatusInUI(dataId, message, isError = false) {
    const orderCardId = `order-card-${dataId}`; // dataId is the idempotencyKey
    const orderCardElement = document.getElementById(orderCardId);

    if (orderCardElement) {
        let statusEl = orderCardElement.querySelector('.payment-processing-status');
        if (!statusEl) {
            statusEl = document.createElement('p');
            statusEl.className = 'payment-processing-status mt-2 text-sm italic';
            // Find a good place to append it, e.g., before the button container or at the end
            const buttonContainer = orderCardElement.querySelector('.mt-4'); // Assuming this is the button div
            if (buttonContainer) {
                buttonContainer.parentNode.insertBefore(statusEl, buttonContainer);
            } else {
                orderCardElement.appendChild(statusEl);
            }
        }
        statusEl.textContent = message;
        if (isError) {
            statusEl.classList.remove('text-green-700', 'text-blue-700');
            statusEl.classList.add('text-red-700');
        } else {
            statusEl.classList.remove('text-red-700', 'text-green-700');
            statusEl.classList.add('text-blue-700'); // Default for info
        }
    } else {
        console.warn(`Order card ${orderCardId} not found for status update: ${message}`);
    }
}


function handleImageDataChunk(chunkData, clientPeerId) {
    const { dataId, chunkIndex, chunkData: imagePart, totalChunks, isLastChunk } = chunkData;
    console.log(`Received chunk ${chunkIndex + 1}/${totalChunks} for dataId: ${dataId} from ${clientPeerId}`);

    if (!incomingImageChunks[dataId]) {
        console.error(`Received chunk for unknown dataId: ${dataId}. Discarding.`);
        // Optionally, send an error back to the client.
        const clientConn = connectedClients[clientPeerId];
        if (clientConn && clientConn.open) {
            clientConn.send({ type: 'chunkError', dataId: dataId, message: 'Unknown dataId. Please resend order metadata.' });
        }
        return;
    }

    const assemblyInfo = incomingImageChunks[dataId];
    if (assemblyInfo.status === 'completed' || assemblyInfo.status === 'failed') {
        console.warn(`Received chunk for already processed dataId: ${dataId} (status: ${assemblyInfo.status}). Discarding.`);
        return;
    }

    // Initialize totalChunks if this is the first chunk
    if (assemblyInfo.totalChunks === -1) {
        assemblyInfo.totalChunks = totalChunks;
        assemblyInfo.chunks = new Array(totalChunks); // Initialize array of correct size
    }

    if (chunkIndex >= assemblyInfo.totalChunks) {
        console.error(`Received chunkIndex ${chunkIndex} which is out of bounds for totalChunks ${assemblyInfo.totalChunks} for dataId ${dataId}.`);
        updateOrderStatusInUI(dataId, `Error: Received invalid image chunk index.`, true);
        assemblyInfo.status = 'failed';
        delete incomingImageChunks[dataId]; // Clean up
        return;
    }

    if (!assemblyInfo.chunks[chunkIndex]) { // Avoid processing duplicate chunks
        assemblyInfo.chunks[chunkIndex] = imagePart;
        assemblyInfo.receivedChunks++;
    } else {
        console.warn(`Received duplicate chunk ${chunkIndex + 1}/${totalChunks} for dataId: ${dataId}. Ignoring.`);
    }

    const percentageComplete = assemblyInfo.totalChunks > 0 ? Math.round((assemblyInfo.receivedChunks / assemblyInfo.totalChunks) * 100) : 0;
    updateOrderStatusInUI(dataId, `Receiving image for order... ${percentageComplete}% (${assemblyInfo.receivedChunks}/${assemblyInfo.totalChunks} chunks).`);

    if (assemblyInfo.receivedChunks === assemblyInfo.totalChunks && assemblyInfo.totalChunks > 0) { // Ensure totalChunks is known
        // All chunks received, attempt to reassemble
        console.log(`All ${totalChunks} chunks received for dataId: ${dataId}. Reassembling...`);
        try {
            const fullDataUrl = assemblyInfo.chunks.join('');
            // Update the original orderData stored in assemblyInfo
            assemblyInfo.orderData.designDataUrl = fullDataUrl;
            // Mark that it's no longer waiting for chunks for display purposes in displayNewOrder
            assemblyInfo.orderData.designDataUrlComingInChunks = false;
            assemblyInfo.status = 'completed';

            // Refresh the card with the complete image
            displayNewOrder(assemblyInfo.orderData, clientPeerId);
            updateOrderStatusInUI(dataId, `Image reassembled and displayed.`); // Final status update

            delete incomingImageChunks[dataId]; // Clean up after successful assembly
        } catch (error) {
            console.error(`Error reassembling data for dataId ${dataId}:`, error);
            updateOrderStatusInUI(dataId, `Error: Failed to reassemble image data. ${error.message}`, true);
            assemblyInfo.status = 'failed';
            // Notify client?
            const clientConn = connectedClients[clientPeerId];
            if (clientConn && clientConn.open) {
                clientConn.send({ type: 'chunkError', dataId: dataId, message: 'Failed to reassemble image on shop side.' });
            }
            delete incomingImageChunks[dataId]; // Clean up
        }
    } else if (isLastChunk && assemblyInfo.receivedChunks < assemblyInfo.totalChunks) {
        // This case should ideally not happen if totalChunks is accurate and no chunks are lost.
        // It means the last chunk was received, but we are still missing some.
        console.warn(`Last chunk received for ${dataId}, but not all chunks are present. Received: ${assemblyInfo.receivedChunks}, Expected: ${assemblyInfo.totalChunks}`);
        updateOrderStatusInUI(dataId, `Warning: Last image chunk received, but some previous chunks might be missing. Waiting for more...`, true);
    }
}

function handleImageDataAbort(abortData, clientPeerId) {
    const { dataId, message } = abortData;
    console.error(`Client ${clientPeerId} aborted image data transfer for dataId ${dataId}: ${message}`);
    if (incomingImageChunks[dataId]) {
        incomingImageChunks[dataId].status = 'failed';
        updateOrderStatusInUI(dataId, `Image transfer aborted by client: ${message}`, true);
        // Optionally, remove the partial order card or mark it as failed permanently
        const orderCardElement = document.getElementById(`order-card-${dataId}`);
        if (orderCardElement) {
            const processBtn = orderCardElement.querySelector('.process-payment-btn');
            if(processBtn) {
                processBtn.disabled = true;
                processBtn.textContent = "Image Failed";
            }
        }
        delete incomingImageChunks[dataId]; // Clean up
    }
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
        alert(msg);
        return;
    }
    const squareSecretKey = squareApiKeyInputEl.value.trim();

    if (statusEl) statusEl.textContent = 'Processing payment with Square...';
    if (processBtn) processBtn.disabled = true;

    console.log("Attempting to process payment for order:", orderData);
    console.log("Using Square API Key (masked for log):", "********" + squareSecretKey.slice(-4));

    // --- Direct Square API Call from Browser ---
    // WARNING: This is generally not recommended for security reasons.
    // The Square Secret API Key will be present in the browser's memory and network requests.
    // Proceeding as per user's understanding of the risks for their specific environment.

    const SQUARE_API_URL = 'https://connect.squareupsandbox.com/v2/payments'; // For Sandbox
    // For production, use: 'https://connect.squareup.com/v2/payments';

    const paymentPayload = {
        source_id: orderData.sourceId,
        idempotency_key: orderData.idempotencyKey || `peer-order-${Date.now()}`, // Ensure idempotency key
        amount_money: {
            amount: orderData.amountCents, // Square API expects amount as integer in smallest currency unit
            currency: orderData.currency || 'USD'
        },
        // Optional: Add more details if needed by Square API
        // buyer_email_address: orderData.billingContact?.email,
        // note: `Order for ${orderData.orderDetails?.quantity} stickers (${orderData.orderDetails?.material})`,
    };

    try {
        console.log("Sending CreatePayment request to Square API:", JSON.stringify(paymentPayload));
        const response = await fetch(SQUARE_API_URL, {
            method: 'POST',
            headers: {
                'Square-Version': '2023-10-18', // Use a recent API version
                'Authorization': `Bearer ${squareSecretKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentPayload)
        });

        const responseData = await response.json();
        console.log("Square API Response:", responseData);

        if (!response.ok || responseData.errors) {
            let errorMessage = "Payment processing failed.";
            if (responseData.errors && responseData.errors.length > 0) {
                errorMessage = responseData.errors.map(err => `[${err.category}/${err.code}]: ${err.detail}`).join('; ');
            } else if (responseData.error && responseData.error.message) { // Older error format
                 errorMessage = responseData.error.message;
            } else if (response.statusText) {
                errorMessage = `Square API Error: ${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        // Payment successful
        const payment = responseData.payment;
        if (statusEl) {
            statusEl.textContent = `Success! Payment ID: ${payment.id}. Order confirmed.`;
            statusEl.classList.remove('text-red-700');
            statusEl.classList.add('text-green-700');
        }
        if (processBtn) processBtn.textContent = "Payment Processed";

        const clientConn = connectedClients[clientPeerId];
        if (clientConn && clientConn.open) {
            clientConn.send({
                type: 'paymentResponse',
                success: true,
                paymentId: payment.id,
                orderId: payment.order_id, // Square uses order_id
                message: 'Your payment was successful and the order is confirmed!',
            });
        }

        // Here you would typically also save the order details locally at the print shop,
        // associate it with the Square payment ID, and manage fulfillment.
        // Also, consider IPFS upload of the design here if needed.

    } catch (error) {
        console.error("Error processing payment with Square API:", error);
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message}`;
            statusEl.classList.remove('text-green-700');
            statusEl.classList.add('text-red-700');
        }
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.textContent = "Retry Payment";
        }

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
