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
        console.log("[SHOP] Destroying existing peer instance before creating a new one.");
        try {
            peer.destroy();
        } catch (e) {
            console.error("[SHOP] Error destroying previous peer instance:", e);
        }
    }

    const peerIdToUse = requestedId && requestedId.trim() !== '' ? requestedId.trim() : null;

    try {
        if (typeof Peer === 'undefined') {
            console.error("[SHOP] PeerJS library is not loaded!");
            updateShopPeerStatus("PeerJS library not loaded!", "error", "Error");
            return;
        }

        console.log(`[SHOP] Initializing shop peer with ID: ${peerIdToUse || '(auto-generated)'}`);
        peer = new Peer(peerIdToUse, {
            // debug: 3 // Uncomment for verbose PeerJS logging
        });
        updateShopPeerStatus("Initializing...", "pending", "Initializing...");

        peer.on('open', (id) => {
            currentShopPeerId = id;
            console.log('[SHOP] Print Shop PeerJS ID is:', currentShopPeerId);
            updateShopPeerStatus(`Listening for orders. Share this ID with the client app.`, "success", currentShopPeerId);
            if (shopPeerIdInput && !shopPeerIdInput.value && peerIdToUse === null) { // Update input if ID was auto-generated
                shopPeerIdInput.value = currentShopPeerId;
            }
        });

        peer.on('connection', (conn) => {
            console.log(`[SHOP] Incoming connection from client: ${conn.peer}`);
            updateShopPeerStatus(`Connected to client: ${conn.peer.substring(0,8)}...`, "success", currentShopPeerId);
            if(noOrdersMessage) noOrdersMessage.style.display = 'none';

            connectedClients[conn.peer] = conn;

            conn.on('data', (dataFromClient) => {
                // For large data (like embedded image data), JSON.stringify might be too slow or crash browser.
                // Log metadata or a summary instead if dataFromClient can be very large.
                let loggableData = dataFromClient;
                if (dataFromClient && dataFromClient.designDataUrl && dataFromClient.designDataUrl.length > 1000) { // Heuristic for large data
                    loggableData = {...dataFromClient, designDataUrl: `(data URL length: ${dataFromClient.designDataUrl.length})`};
                } else if (dataFromClient && dataFromClient.chunkData && dataFromClient.chunkData.length > 1000) {
                    loggableData = {...dataFromClient, chunkData: `(chunk data length: ${dataFromClient.chunkData.length})`};
                }
                console.log(`[SHOP] Received data from ${conn.peer}:`, JSON.stringify(loggableData));

                const dataId = dataFromClient.idempotencyKey || (dataFromClient.orderDetails ? dataFromClient.orderDetails.idempotencyKey : null) || dataFromClient.dataId;

                const originalType = dataFromClient.type;
                const cleanedType = originalType ? String(originalType).replace(/[^a-zA-Z0-9]/g, "") : "";
                console.log(`[SHOP] Detailed type check: Original type is "${originalType}", Cleaned type is "${cleanedType}", dataId: ${dataId}`);

                if (cleanedType === "newOrder") {
                    console.log(`[SHOP] Processing newOrder for dataId: ${dataId}. designDataUrlComingInChunks: ${dataFromClient.designDataUrlComingInChunks}`);
                    if (dataFromClient.designDataUrlComingInChunks) {
                        if (!dataId) {
                            console.error("[SHOP] Received newOrder with designDataUrlComingInChunks but no valid dataId (idempotencyKey)!", dataFromClient);
                            return;
                        }
                        incomingImageChunks[dataId] = {
                            orderData: dataFromClient,
                            chunks: [],
                            receivedChunks: 0,
                            totalChunks: -1,
                            clientPeerId: conn.peer,
                            status: 'waiting_chunks'
                        };
                        console.log(`[SHOP] New order ${dataId} from ${conn.peer} - expecting image data in chunks. Stored in incomingImageChunks.`);
                        displayNewOrder(dataFromClient, conn.peer);
                        updateOrderStatusInUI(dataId, `Receiving image for order... 0%`);
                    } else {
                        console.log(`[SHOP] New order ${dataId} from ${conn.peer} - image data expected to be embedded or not present.`);
                        displayNewOrder(dataFromClient, conn.peer);
                    }
                } else if (cleanedType === "imageDataChunk") {
                    if (!dataId) {
                        console.error("[SHOP] Received imageDataChunk but no dataId!", dataFromClient);
                        return;
                    }
                    handleImageDataChunk(dataFromClient, conn.peer);
                } else if (cleanedType === "imageDataAbort") {
                    console.log(`[SHOP] Received imageDataAbort for dataId: ${dataId}`);
                    handleImageDataAbort(dataFromClient, conn.peer);
                } else {
                    console.warn(`[SHOP] Received unknown data type. Original: '${originalType}', Cleaned: '${cleanedType}' from client ${conn.peer}:`, dataFromClient);
                }
            });

            conn.on('close', () => {
                console.log(`[SHOP] Connection from ${conn.peer} closed.`);
                handleClientDisconnect(conn.peer);
            });

            conn.on('error', (err) => {
                console.error(`[SHOP] Error with connection from ${conn.peer}:`, err);
                updateShopPeerStatus(`Error with client ${conn.peer.substring(0,8)}...`, "error", currentShopPeerId);
                const orderCard = findOrderCardByClientPeerId(conn.peer); // This function isn't defined, might need to implement or remove if not used
                if (orderCard) {
                    const statusEl = orderCard.querySelector('.payment-processing-status');
                    if(statusEl) statusEl.textContent = `Connection Error: ${err.message}`;
                }
            });
        });

        peer.on('disconnected', () => {
            console.warn('[SHOP] Shop peer disconnected from PeerJS server. Attempting to reconnect...');
            updateShopPeerStatus("Disconnected from PeerJS server. Reconnecting...", "pending", "Reconnecting...");
            if (peer && !peer.destroyed) {
                try { peer.reconnect(); } catch(e) { console.error("[SHOP] Error reconnecting peer:", e); }
            }
        });

        peer.on('close', () => {
            console.log('[SHOP] Shop peer instance closed.');
            updateShopPeerStatus("Peer connection closed. Please Set/Refresh ID.", "error", "Closed");
            currentShopPeerId = null;
        });

        peer.on('error', (err) => {
            console.error('[SHOP] Shop PeerJS general error:', err);
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
    console.log(`[SHOP] Client ${clientPeerId} disconnected.`);
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
    const logMessage = `[SHOP PeerJS Status] ${type.toUpperCase()}: ${message} (Peer ID Text: ${peerIdText})`;
    console.log(logMessage);

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
    console.log(`[SHOP] displayNewOrder called for clientPeerId: ${clientPeerId}, orderData idempotencyKey: ${orderData.idempotencyKey}`);
    if (!ordersListDiv) {
        console.error("[SHOP] ordersListDiv not found, cannot display order.");
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
    // Avoid logging the full imagePart if it's large
    const loggableChunkData = {...chunkData, chunkData: `(chunk data length: ${imagePart.length})`};
    console.log(`[SHOP] Received imageDataChunk: ${JSON.stringify(loggableChunkData)} from ${clientPeerId}`);


    if (!incomingImageChunks[dataId]) {
        console.error(`[SHOP] Received chunk for unknown dataId: ${dataId}. Discarding.`);
        const clientConn = connectedClients[clientPeerId];
        if (clientConn && clientConn.open) {
            clientConn.send({ type: 'chunkError', dataId: dataId, message: 'Unknown dataId. Please resend order metadata.' });
        }
        return;
    }

    const assemblyInfo = incomingImageChunks[dataId];
    if (assemblyInfo.status === 'completed' || assemblyInfo.status === 'failed') {
        console.warn(`[SHOP] Received chunk for already processed dataId: ${dataId} (status: ${assemblyInfo.status}). Discarding.`);
        return;
    }

    if (assemblyInfo.totalChunks === -1) { // Initialize totalChunks if this is the first chunk
        assemblyInfo.totalChunks = totalChunks;
        assemblyInfo.chunks = new Array(totalChunks);
        console.log(`[SHOP] Initialized chunk assembly for dataId ${dataId}. Expecting ${totalChunks} chunks.`);
    }

    if (chunkIndex >= assemblyInfo.totalChunks) {
        console.error(`[SHOP] Received chunkIndex ${chunkIndex} which is out of bounds for totalChunks ${assemblyInfo.totalChunks} for dataId ${dataId}.`);
        updateOrderStatusInUI(dataId, `Error: Received invalid image chunk index.`, true);
        assemblyInfo.status = 'failed';
        delete incomingImageChunks[dataId];
        return;
    }

    if (!assemblyInfo.chunks[chunkIndex]) {
        assemblyInfo.chunks[chunkIndex] = imagePart;
        assemblyInfo.receivedChunks++;
    } else {
        console.warn(`[SHOP] Received duplicate chunk ${chunkIndex + 1}/${totalChunks} for dataId: ${dataId}. Ignoring.`);
    }

    const percentageComplete = assemblyInfo.totalChunks > 0 ? Math.round((assemblyInfo.receivedChunks / assemblyInfo.totalChunks) * 100) : 0;
    console.log(`[SHOP] Chunk assembly for dataId ${dataId}: ${assemblyInfo.receivedChunks}/${assemblyInfo.totalChunks} chunks received (${percentageComplete}%).`);
    updateOrderStatusInUI(dataId, `Receiving image for order... ${percentageComplete}% (${assemblyInfo.receivedChunks}/${assemblyInfo.totalChunks} chunks).`);

    if (assemblyInfo.receivedChunks === assemblyInfo.totalChunks && assemblyInfo.totalChunks > 0) {
        console.log(`[SHOP] All ${totalChunks} chunks received for dataId: ${dataId}. Attempting to reassemble...`);
        try {
            const fullDataUrl = assemblyInfo.chunks.join('');
            console.log(`[SHOP] Reassembly successful for dataId ${dataId}. Full data URL length: ${fullDataUrl.length}`);
            assemblyInfo.orderData.designDataUrl = fullDataUrl;
            assemblyInfo.orderData.designDataUrlComingInChunks = false; // Mark as complete
            assemblyInfo.status = 'completed';

            displayNewOrder(assemblyInfo.orderData, clientPeerId); // Refresh card with image
            updateOrderStatusInUI(dataId, `Image reassembled and displayed.`);

            delete incomingImageChunks[dataId];
        } catch (error) {
            console.error(`[SHOP] Error reassembling data for dataId ${dataId}:`, error);
            updateOrderStatusInUI(dataId, `Error: Failed to reassemble image data. ${error.message}`, true);
            assemblyInfo.status = 'failed';
            const clientConn = connectedClients[clientPeerId];
            if (clientConn && clientConn.open) {
                clientConn.send({ type: 'chunkError', dataId: dataId, message: 'Failed to reassemble image on shop side.' });
            }
            delete incomingImageChunks[dataId];
        }
    } else if (isLastChunk && assemblyInfo.receivedChunks < assemblyInfo.totalChunks) {
        console.warn(`[SHOP] Last chunk received for ${dataId}, but not all chunks are present. Received: ${assemblyInfo.receivedChunks}, Expected: ${assemblyInfo.totalChunks}. This might indicate lost chunks.`);
        updateOrderStatusInUI(dataId, `Warning: Last image chunk received, but some previous chunks might be missing. Waiting...`, true);
    }
}

function handleImageDataAbort(abortData, clientPeerId) {
    const { dataId, message } = abortData;
    console.error(`[SHOP] Client ${clientPeerId} aborted image data transfer for dataId ${dataId}: ${message}`);
    if (incomingImageChunks[dataId]) {
        incomingImageChunks[dataId].status = 'failed';
        updateOrderStatusInUI(dataId, `Image transfer aborted by client: ${message}`, true);
        const orderCardElement = document.getElementById(`order-card-${dataId}`);
        if (orderCardElement) {
            const processBtn = orderCardElement.querySelector('.process-payment-btn');
            if(processBtn) {
                processBtn.disabled = true;
                processBtn.textContent = "Image Failed";
            }
        }
        delete incomingImageChunks[dataId];
    }
}

// Inside handleProcessPayment function in printshop.js

// ... (other parts of the function like getting orderData)

    // const squareSecretKey = squareApiKeyInputEl.value.trim(); // NO LONGER USED HERE if calling your backend

    // OLD WAY - Directly calling Square (THIS IS WHAT YOUR LOGS SHOW IS STILL HAPPENING)
    // const SQUARE_API_URL = 'https://connect.squareupsandbox.com/v2/payments'; 

    
Action Items:
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
    //const squareSecretKey = squareApiKeyInputEl.value.trim();

    if (statusEl) statusEl.textContent = 'Processing payment with Square...';
    if (processBtn) processBtn.disabled = true;

    console.log("[SHOP] Attempting to process payment for orderData:", JSON.stringify(orderData));
    // The squareSecretKey is not used when calling a backend, so no need to log it here in that context.
    // If direct Square API call was still an option, then logging its presence (not value) would be relevant.

    const YOUR_NODE_SERVER_URL = 'http://localhost:3000/api/process-payment'; // Or your actual hosted URL if deployed

    const paymentPayloadForFunction = {
        sourceId: orderData.sourceId,
        idempotencyKey: orderData.idempotencyKey || `peer-order-${Date.now()}`,
        amountCents: orderData.amountCents,
        currency: orderData.currency || 'USD',
        // billingContact: orderData.billingContact, // You might want to pass this to your backend
        // orderDetails: orderData.orderDetails, // And this too
    };
    console.log("[SHOP] Calling backend server for payment. URL:", YOUR_NODE_SERVER_URL);
    console.log("[SHOP] Payload for backend server:", JSON.stringify(paymentPayloadForFunction));

    try {
        const response = await fetch(YOUR_NODE_SERVER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // The Square Secret API Key is NOT sent from here to your backend.
                // Your backend uses its own configured SQUARE_ACCESS_TOKEN.
            },
            body: JSON.stringify(paymentPayloadForFunction)
        });

        // Try to always get text first for better error diagnosis if JSON parsing fails
        const responseText = await response.text();
        console.log("[SHOP] Raw response text from backend server:", responseText);

        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            console.error("[SHOP] Failed to parse JSON response from backend:", e);
            throw new Error(`Non-JSON response from server: ${response.status} ${response.statusText}. Body: ${responseText}`);
        }

        console.log("[SHOP] Parsed JSON response from backend server:", responseData);

        if (!response.ok || responseData.error) { // Check response.ok for HTTP status errors
            let errorMessage = "Payment processing failed via backend.";
            if (responseData.error && responseData.details) { // Square-like error structure
                errorMessage = responseData.details.map(err => `[${err.category}/${err.code}]: ${err.detail}`).join('; ');
            } else if (responseData.error) { // Simpler error message from backend
                errorMessage = responseData.error;
            } else if (!response.ok) {
                errorMessage = `Backend server error: ${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        // Payment successful path
        const payment = responseData.payment; // Assuming backend returns the payment object from Square
        console.log("[SHOP] Payment successful via backend. Square Payment:", payment);

        if (statusEl) {
            statusEl.textContent = `Success! Payment ID: ${payment?.id || 'N/A'}. Order confirmed.`;
            statusEl.classList.remove('text-red-700', 'text-blue-700');
            statusEl.classList.add('text-green-700');
        }
        if (processBtn) processBtn.textContent = "Payment Processed";

        const clientConn = connectedClients[clientPeerId];
        const paymentResponseToClient = {
            type: 'paymentResponse',
            success: true,
            paymentId: payment?.id,
            orderId: payment?.order_id, // Square uses order_id
            message: 'Your payment was successful and the order is confirmed!',
            // designIpfsHash: "placeholder_if_shop_uploads_to_ipfs" // Example if shop handles IPFS
        };
        console.log("[SHOP] Sending successful paymentResponse to client:", JSON.stringify(paymentResponseToClient));
        if (clientConn && clientConn.open) {
            clientConn.send(paymentResponseToClient);
        }

    } catch (error) {
        console.error("[SHOP] Error processing payment via backend server:", error);
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message}`;
            statusEl.classList.remove('text-green-700', 'text-blue-700');
            statusEl.classList.add('text-red-700');
        }
        if (processBtn) {
            processBtn.disabled = false; // Re-enable button on failure
            processBtn.textContent = "Retry Payment";
        }

        const clientConn = connectedClients[clientPeerId];
        const errorResponseToClient = {
            type: 'paymentResponse',
            success: false,
            message: `Payment processing failed: ${error.message}`
        };
        console.log("[SHOP] Sending failed paymentResponse to client:", JSON.stringify(errorResponseToClient));
        if (clientConn && clientConn.open) {
            clientConn.send(errorResponseToClient);
        }
    }
}
// } // This curly brace seems to be a leftover from commented out code, removing it.


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
