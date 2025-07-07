// index.js

const appId = "sandbox-sq0idb-nbW_Oje9Dm0L5YvQ7WP2ow";
const locationId = "LTS82DEX24XR0";

// --- PeerJS Configuration ---
// IMPORTANT: Replace 'YOUR_PRINT_SHOP_PEER_ID_PLACEHOLDER' with the actual, stable Peer ID
// that your local print shop application will use to register with the PeerJS server.
const PRINT_SHOP_PEER_ID = 'printshop_splotch_1';
let peer; // PeerJS instance for this client
let connToShop; // PeerJS DataConnection to the print shop
let peerJsStatusContainer;


// Declare globals for SDK objects and key DOM elements
let payments, card;
let originalImage = null;
let canvas, ctx;

let textInput, textSizeInput, textColorInput, addTextBtn, textFontFamilySelect;
let stickerMaterialSelect, designMarginNote, stickerQuantityInput, calculatedPriceDisplay;
let paymentStatusContainer, ipfsLinkContainer, fileInputGlobalRef, paymentFormGlobalRef, fileNameDisplayEl;
let rotateLeftBtnEl, rotateRightBtnEl, resizeInputEl, resizeBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl;

let currentOrderAmountCents = 0;
const DESIGN_DATA_URL_JSON_THRESHOLD = 10000; // Approx 10KB, well below PeerJS 16KB limit for JSON channel.
const IMAGE_CHUNK_SIZE = 15000; // Slightly less than 16KB for binary channel message size.


// --- PeerJS Helper to update status display ---
function updatePeerJsStatus(message, type = 'info') {
    const logMessage = `[CLIENT PeerJS Status] ${type.toUpperCase()}: ${message}`;
    console.log(logMessage);
    if (!peerJsStatusContainer) peerJsStatusContainer = document.getElementById('peerjs-status-container');
    if (peerJsStatusContainer) {
        peerJsStatusContainer.textContent = `PeerJS Status: ${message}`;
        peerJsStatusContainer.style.visibility = 'visible';
        peerJsStatusContainer.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500', 'bg-gray-400');
        if (type === 'success') peerJsStatusContainer.classList.add('bg-green-500');
        else if (type === 'error') peerJsStatusContainer.classList.add('bg-red-500');
        else if (type === 'warning') peerJsStatusContainer.classList.add('bg-yellow-500');
        else peerJsStatusContainer.classList.add('bg-gray-400'); // Default/info
    } else {
        // Already logged with prefix
    }
}

// --- Initialize PeerJS ---
function initializePeer() {
    console.log('[CLIENT] Initializing PeerJS. PRINT_SHOP_PEER_ID:', PRINT_SHOP_PEER_ID);
    if (typeof Peer === 'undefined') {
        console.error("[CLIENT] PeerJS library is not loaded!");
        updatePeerJsStatus("PeerJS library not loaded!", "error");
        showPaymentStatus("Error: P2P connection library missing. Cannot connect to print shop.", "error");
        // Disable payment form if PeerJS is critical
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true;
        }
        return;
    }

    peer = new Peer(); // Uses the default public PeerJS server
    updatePeerJsStatus("Initializing...");

    peer.on('open', function(id) {
        console.log('[CLIENT] My client peer ID is: ' + id);
        updatePeerJsStatus(`My ID: ${id.substring(0,8)}... Waiting to connect.`);
        connectToPrintShop();
    });

    peer.on('connection', function(incomingConn) {
        console.log('[CLIENT] Incoming connection (unexpected for client):', incomingConn);
        incomingConn.on('data', function(data) {
            console.log('[CLIENT] Received unexpected data from incoming connection:', data);
        });
    });

    peer.on('disconnected', function() {
        console.warn('[CLIENT] Disconnected from PeerJS server.');
        updatePeerJsStatus("Disconnected from PeerJS server. Attempting to reconnect...", "warning");
        if (peer && !peer.destroyed) {
            try { peer.reconnect(); } catch (e) { console.error("[CLIENT] Error reconnecting peer:", e); }
        }
    });

    peer.on('close', function() {
        console.warn('[CLIENT] Peer instance closed.');
        updatePeerJsStatus("Peer instance closed.", "error");
        connToShop = null;
    });

    peer.on('error', function(err) {
        console.error('[CLIENT] PeerJS general error:', err);
        let message = `PeerJS Error: ${err.message || err.type || 'Unknown error'}`;
        if (err.type === 'peer-unavailable') {
            message = `Print shop (${PRINT_SHOP_PEER_ID ? PRINT_SHOP_PEER_ID.substring(0,8) : 'N/A'}...) is unavailable. Please try again later.`;
        } else if (err.type === 'network') {
            message = "Network error with PeerJS. Check connection.";
        } else if (err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
            message = "PeerJS server connection error. Please try again later.";
        }
        updatePeerJsStatus(message, "error");
        showPaymentStatus(message, 'error');
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
             paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true;
        }
    });
}

function connectToPrintShop() {
    if (!peer || peer.destroyed) {
        console.error("[CLIENT] PeerJS not initialized or destroyed. Cannot connect.");
        updatePeerJsStatus("PeerJS not ready.", "error");
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true;
        }
        return;
    }
    if (!PRINT_SHOP_PEER_ID || PRINT_SHOP_PEER_ID === 'YOUR_PRINT_SHOP_PEER_ID_PLACEHOLDER') {
        console.error("[CLIENT] Print Shop Peer ID is not configured!", PRINT_SHOP_PEER_ID);
        updatePeerJsStatus("Print shop ID missing.", "error");
        showPaymentStatus("Configuration error: Print shop ID not set.", "error");
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true;
        }
        return;
    }

    if (connToShop && connToShop.open) {
        console.log("[CLIENT] Already connected to print shop:", connToShop.peer);
        updatePeerJsStatus(`Connected to Print Shop (${PRINT_SHOP_PEER_ID.substring(0,8)}...).`, "success");
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = false;
        }
        return;
    }

    console.log(`[CLIENT] Attempting to connect to print shop peer: ${PRINT_SHOP_PEER_ID}`);
    updatePeerJsStatus(`Connecting to Print Shop (${PRINT_SHOP_PEER_ID.substring(0,8)}...)...`, "info");
    if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
        paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true; // Disable while attempting to connect
    }


    connToShop = peer.connect(PRINT_SHOP_PEER_ID, {
        reliable: true,
        serialization: 'json'
    });

    connToShop.on('open', function() {
        console.log(`[CLIENT] Successfully connected to print shop peer: ${connToShop.peer}`);
        updatePeerJsStatus(`Connected to Print Shop!`, "success");
        showPaymentStatus('Connected to print shop. Ready to process order.', 'info');
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = false;
        }
    });

    connToShop.on('data', function(dataFromServer) {
        console.log('[CLIENT] Received data from print shop:', JSON.stringify(dataFromServer));
        if (dataFromServer.type === 'paymentResponse') {
            if (dataFromServer.success) {
                showPaymentStatus(`Payment successful! Order ID: ${dataFromServer.orderId || 'N/A'}. Payment ID: ${dataFromServer.paymentId ? dataFromServer.paymentId.substring(0,10)+'...' : 'N/A'}`, 'success');
                // IPFS upload is now expected to be handled by the print shop.
                // Client could display an IPFS hash if the shop sends it back.
                if (dataFromServer.designIpfsHash) {
                    if(ipfsLinkContainer) {
                        ipfsLinkContainer.innerHTML = `Print shop confirmed design upload! <br>IPFS Hash: ${dataFromServer.designIpfsHash} <br>View: <a href="https://ipfs.io/ipfs/${dataFromServer.designIpfsHash}" target="_blank" class="text-indigo-600 hover:text-indigo-800 underline">https://ipfs.io/ipfs/${dataFromServer.designIpfsHash}</a>`;
                        ipfsLinkContainer.style.visibility = 'visible';
                    }
                }
            } else {
                showPaymentStatus(`Payment failed: ${dataFromServer.message || 'Unknown error from print shop.'}`, 'error');
            }
        } else if (dataFromServer.type === 'shopStatus') {
             console.log("[CLIENT] Shop status update:", dataFromServer.message);
            updatePeerJsStatus(`Shop: ${dataFromServer.message}`, 'info');
        } else {
            console.log("[CLIENT] Received unknown data type from shop:", dataFromServer);
        }
    });

    connToShop.on('error', function(err) {
        console.error('[CLIENT] PeerJS connection to shop error:', err);
        updatePeerJsStatus(`Connection error with shop: ${err.message || err.type}`, "error");
        showPaymentStatus(`Connection error with print shop. Please try again. (${err.type})`, 'error');
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true;
        }
    });

    connToShop.on('close', function() {
        console.warn('[CLIENT] Connection to print shop closed.');
        updatePeerJsStatus("Disconnected from Print Shop. Attempting to reconnect...", "warning");
        showPaymentStatus('Disconnected from print shop. Please wait or refresh.', 'error');
        connToShop = null;
        if(paymentFormGlobalRef && paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true;
        }
        // Optional: Implement a retry mechanism for connectToPrintShop
        // setTimeout(connectToPrintShop, 5000);
    });
}


async function BootStrap() {
    canvas = document.getElementById('imageCanvas');
    if (!canvas) {
        console.error("FATAL: imageCanvas element not found. Aborting BootStrap.");
        const body = document.querySelector('body');
        if (body) {
            const errorDiv = document.createElement('div');
            errorDiv.textContent = "Critical error: Image canvas not found. Please refresh or contact support.";
            errorDiv.style.color = "red"; errorDiv.style.padding = "20px"; errorDiv.style.textAlign = "center";
            body.prepend(errorDiv);
        }
        return;
    }
    ctx = canvas.getContext('2d');

    textInput = document.getElementById('textInput');
    textSizeInput = document.getElementById('textSizeInput');
    textColorInput = document.getElementById('textColorInput');
    addTextBtn = document.getElementById('addTextBtn');
    textFontFamilySelect = document.getElementById('textFontFamily');
    stickerMaterialSelect = document.getElementById('stickerMaterial');
    designMarginNote = document.getElementById('designMarginNote');
    stickerQuantityInput = document.getElementById('stickerQuantity');
    calculatedPriceDisplay = document.getElementById('calculatedPriceDisplay');
    paymentStatusContainer = document.getElementById('payment-status-container');
    ipfsLinkContainer = document.getElementById('ipfsLinkContainer');
    fileInputGlobalRef = document.getElementById('file');
    fileNameDisplayEl = document.getElementById('fileNameDisplay');
    paymentFormGlobalRef = document.getElementById('payment-form');
    peerJsStatusContainer = document.getElementById('peerjs-status-container');


    rotateLeftBtnEl = document.getElementById('rotateLeftBtn');
    rotateRightBtnEl = document.getElementById('rotateRightBtn');
    resizeInputEl = document.getElementById('resizeInput');
    resizeBtnEl = document.getElementById('resizeBtn');
    startCropBtnEl = document.getElementById('startCropBtn');
    grayscaleBtnEl = document.getElementById('grayscaleBtn');
    sepiaBtnEl = document.getElementById('sepiaBtn');

    initializePeer();

    console.log(`Initializing Square SDK with appId: ${appId}, locationId: ${locationId}`);
    try {
        if (!window.Square || !window.Square.payments) {
            throw new Error("Square SDK (window.Square or window.Square.payments) is not loaded.");
        }
        payments = window.Square.payments(appId, locationId);
      } catch (error) {
        // Use showPaymentStatus for user-facing error
        showPaymentStatus(`Failed to initialize Square payments SDK: ${error.message}`, 'error');
        console.error("Failed to initialize Square payments SDK:", error); // Keep console error for details
        return;
      }

      try {
        card = await initializeCard(payments);
      } catch (e) {
        console.error("Initializing Card failed", e);
        showPaymentStatus(`Error initializing card form: ${e.message}`, 'error');
      }

      if (stickerQuantityInput) {
          calculateAndUpdatePrice();
          stickerQuantityInput.addEventListener('input', calculateAndUpdatePrice);
          stickerQuantityInput.addEventListener('change', calculateAndUpdatePrice);
      } else {
          console.warn("Sticker quantity input with ID 'stickerQuantity' not found.");
          currentOrderAmountCents = 100;
          if (calculatedPriceDisplay) calculatedPriceDisplay.textContent = formatPrice(currentOrderAmountCents);
      }

      if (stickerMaterialSelect) {
          stickerMaterialSelect.addEventListener('change', calculateAndUpdatePrice);
      } else {
          console.warn("Sticker material select with ID 'stickerMaterial' not found.");
      }

      if (addTextBtn) {
        addTextBtn.addEventListener('click', handleAddText);
      } else {
        console.warn("Add Text button with ID 'addTextBtn' not found.");
      }

      if (rotateLeftBtnEl) rotateLeftBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
      if (rotateRightBtnEl) rotateRightBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(90));
      if (grayscaleBtnEl) grayscaleBtnEl.addEventListener('click', applyGrayscaleFilter);
      if (sepiaBtnEl) sepiaBtnEl.addEventListener('click', applySepiaFilter);
      if (resizeBtnEl) resizeBtnEl.addEventListener('click', handleResize);
      if (startCropBtnEl) startCropBtnEl.addEventListener('click', handleCrop);

      if (paymentFormGlobalRef) {
        paymentFormGlobalRef.addEventListener('submit', handlePaymentFormSubmit);
        if(paymentFormGlobalRef.querySelector('button[type="submit"]')) {
            paymentFormGlobalRef.querySelector('button[type="submit"]').disabled = true; // Initially disable
        }
        updatePeerJsStatus("Attempting to connect to print shop...", "info");
      } else {
        console.error("Payment form with ID 'payment-form' not found. Payments will not work.");
        showPaymentStatus("Payment form is missing. Cannot process payments.", "error");
      }

      if(fileInputGlobalRef) {
        fileInputGlobalRef.addEventListener('change', handleFileChange);
      } else {
        console.warn("File input with ID 'file' not found.");
      }

      updateEditingButtonsState(!originalImage);
      if (designMarginNote) designMarginNote.style.display = 'none';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', BootStrap);
} else {
    BootStrap();
}

function calculateStickerPrice(quantity, material) {
    if (quantity <= 0) return 0;
    let pricePerStickerCents;
    if (quantity < 50) pricePerStickerCents = 80;
    else if (quantity < 100) pricePerStickerCents = 70;
    else if (quantity < 250) pricePerStickerCents = 60;
    else if (quantity < 500) pricePerStickerCents = 50;
    else pricePerStickerCents = 40;
    let materialMultiplier = 1.0;
    if (material === 'pvc_laminated') materialMultiplier = 1.5;
    return Math.round((quantity * pricePerStickerCents) * materialMultiplier);
}

function calculateAndUpdatePrice() {
    const selectedMaterial = stickerMaterialSelect ? stickerMaterialSelect.value : 'pp_standard';
    if (stickerQuantityInput && calculatedPriceDisplay) {
        const quantity = parseInt(stickerQuantityInput.value, 10);
        if (isNaN(quantity) || quantity < 0) {
            currentOrderAmountCents = 0;
            calculatedPriceDisplay.textContent = quantity < 0 ? "Invalid Quantity" : formatPrice(0);
            return;
        }
        currentOrderAmountCents = calculateStickerPrice(quantity, selectedMaterial);
        calculatedPriceDisplay.textContent = formatPrice(currentOrderAmountCents);
    } else {
        currentOrderAmountCents = calculateStickerPrice(50, selectedMaterial);
        if (calculatedPriceDisplay) calculatedPriceDisplay.textContent = formatPrice(currentOrderAmountCents);
    }
}

function formatPrice(amountInCents) {
    const amountInDollars = amountInCents / 100;
    return amountInDollars.toLocaleString("en-US", {style:"currency", currency:"USD"});
}

async function initializeCard(paymentsSDK) {
  if (!paymentsSDK) {
    console.error("Square payments object not initialized before calling initializeCard.");
    throw new Error("Payments SDK not ready for card initialization.");
  }
  const cardInstance = await paymentsSDK.card();
  await cardInstance.attach("#card-container");
  return cardInstance;
}

async function tokenize(paymentMethod, verificationDetails) {
  if (!paymentMethod) {
    console.error("Card payment method (Square SDK card object) is not available for tokenization.");
    throw new Error("Card payment method not initialized.");
  }
  console.log("Calling card.tokenize() with verificationDetails:", JSON.stringify(verificationDetails, null, 2));
  const tokenResult = await paymentMethod.tokenize(verificationDetails);

  if (tokenResult.status === "OK") {
    if (!tokenResult.token) {
        console.error("Tokenization OK but token is empty/falsy:", tokenResult);
        throw new Error("Tokenization succeeded but no token was returned.");
    }
    console.log("Tokenization successful, token:", tokenResult.token);
    return tokenResult.token;
  }
  let errorMessage = `Tokenization failed: ${tokenResult.status}`;
  if (tokenResult.errors) {
    errorMessage += ` ${JSON.stringify(tokenResult.errors)}`;
    tokenResult.errors.forEach(error => {
      console.error("Tokenization error detail:", error);
      if (error.field) errorMessage += ` (Field: ${error.field})`;
      if (error.message) errorMessage += ` (Message: ${error.message})`;
      if (error.field === "cardNumber" && error.type === "INVALID") {
          errorMessage = "Invalid card number. Please check and try again.";
      }
    });
  }
  throw new Error(errorMessage);
}

function handleAddText() {
    if (!canvas || !ctx) { console.error("Canvas or context not initialized for handleAddText"); return; }
    if (!originalImage && ctx.getImageData(0,0,1,1).data[3] === 0) {
        showPaymentStatus("Please load an image before adding text.", 'error'); return;
    }
    if (!textInput || !textSizeInput || !textColorInput || !textFontFamilySelect) {
        console.error("Text input elements not found for handleAddText.");
        showPaymentStatus("Text input elements are missing.", 'error'); return;
    }
    const text = textInput.value; const size = parseInt(textSizeInput.value, 10);
    const color = textColorInput.value; const font = textFontFamilySelect.value;
    if (!text.trim()) { showPaymentStatus("Please enter some text to add.", 'error'); return; }
    if (isNaN(size) || size <= 0) { showPaymentStatus("Please enter a valid font size.", 'error'); return; }
    ctx.font = `${size}px ${font}`; ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    showPaymentStatus(`Text "${text}" added.`, 'success');
}

async function handlePaymentFormSubmit(event) {
    console.log('[CLIENT] handlePaymentFormSubmit triggered.');
    event.preventDefault();
    console.log('[CLIENT] handlePaymentFormSubmit: event.preventDefault() called.');

    if (ipfsLinkContainer) {
      console.log('[CLIENT] handlePaymentFormSubmit: Resetting IPFS link container.');
      ipfsLinkContainer.innerHTML = '';
      ipfsLinkContainer.className = 'mt-6 p-4 border rounded-md text-sm bg-gray-50 shadow';
      ipfsLinkContainer.style.visibility = 'hidden';
    }
    showPaymentStatus('Processing order...', 'info');
    console.log('[CLIENT] handlePaymentFormSubmit: Initial "Processing order..." status shown.');

    if (!connToShop || !connToShop.open) {
        console.warn('[CLIENT] handlePaymentFormSubmit: No connection to shop or connection not open. connToShop:', connToShop, 'connToShop.open:', connToShop ? connToShop.open : 'N/A');
        showPaymentStatus('Not connected to the print shop. Please wait or try refreshing. Ensure the print shop application is running.', 'error');
        console.error('[CLIENT] PeerJS connection to shop not open or not established for submitting payment.');
        if (!connToShop && peer && !peer.destroyed && PRINT_SHOP_PEER_ID !== 'YOUR_PRINT_SHOP_PEER_ID_PLACEHOLDER') {
            console.log('[CLIENT] handlePaymentFormSubmit: Attempting to reconnect to print shop.');
            updatePeerJsStatus("Attempting to reconnect to print shop...", "warning");
            connectToPrintShop(); // Try to reconnect
        }
        return;
    }
    console.log('[CLIENT] handlePaymentFormSubmit: Connection to shop is open.');

    if (currentOrderAmountCents <= 0) {
      console.warn('[CLIENT] handlePaymentFormSubmit: Invalid order amount. currentOrderAmountCents:', currentOrderAmountCents);
      showPaymentStatus('Invalid order amount. Please check sticker quantity/material.', 'error'); return;
    }
    console.log('[CLIENT] handlePaymentFormSubmit: Order amount is valid. currentOrderAmountCents:', currentOrderAmountCents);

    try {
      console.log('[CLIENT] handlePaymentFormSubmit: Entering try block for payment processing.');
      const billingContact = {
        givenName: document.getElementById('firstName').value || undefined,
        familyName: document.getElementById('lastName').value || undefined,
        email: document.getElementById('email').value || undefined,
        phone: document.getElementById('phone').value || undefined,
        addressLines: [document.getElementById('address').value || '123 Main St'],
        city: document.getElementById('city').value || undefined,
        state: document.getElementById('state').value || 'CA',
        postalCode: document.getElementById('postalCode').value || '90210',
        countryCode: "US",
      };
      if (!billingContact.givenName || !billingContact.familyName || !billingContact.email || !billingContact.addressLines[0] || !billingContact.city || !billingContact.state || !billingContact.postalCode) {
          throw new Error("Please fill in all required billing details.");
      }
      if (!card) { throw new Error("Card payment method not initialized. Please refresh the page."); }

      const verificationDetails = {
        amount: String(currentOrderAmountCents),
        billingContact: billingContact,
        currencyCode: "USD",
        intent: "CHARGE",
        customerInitiated: true,
        sellerKeyedIn: false
      };

      showPaymentStatus('Tokenizing card...', 'info');
      const cardNonce = await tokenize(card, verificationDetails);

      showPaymentStatus('Card tokenized. Sending order to print shop...', 'info');
      const orderDetails = {
          quantity: stickerQuantityInput ? parseInt(stickerQuantityInput.value, 10) : 0,
          material: stickerMaterialSelect ? stickerMaterialSelect.value : 'unknown',
          cutLineFileName: document.getElementById('cutLineFile') && document.getElementById('cutLineFile').files.length > 0 ? document.getElementById('cutLineFile').files[0].name : null,
      };

      let designDataUrl = null;
      if (canvas && (originalImage || (ctx && ctx.getImageData(0,0,1,1).data[3] > 0)) ) {
          try {
            designDataUrl = canvas.toDataURL('image/png');
          } catch (e) {
            console.error("Error getting canvas data URL for PeerJS:", e);
            showPaymentStatus("Error preparing design image. Please try again.", "error");
          }
      }

      const payloadToShop = {
        type: 'newOrder',
        sourceId: cardNonce,
        amountCents: currentOrderAmountCents,
        currency: "USD",
        idempotencyKey: window.crypto.randomUUID(),
        orderDetails: orderDetails,
        billingContact: billingContact,
        // designDataUrl will be handled based on its size
      };
      console.log('[CLIENT] Preparing to send order to print shop. Full payloadToShop (metadata):', JSON.stringify(payloadToShop));


      if (designDataUrl && designDataUrl.length > DESIGN_DATA_URL_JSON_THRESHOLD) {
        payloadToShop.designDataUrlComingInChunks = true;
        payloadToShop.designDataUrl = null; // Don't send it in the main JSON
        console.log("[CLIENT] Design data URL is large, will be sent in chunks. designDataUrl.length:", designDataUrl.length, "Payload metadata size (approx string length):", JSON.stringify(payloadToShop).length);
        connToShop.send(payloadToShop); // Send metadata first
        showPaymentStatus('Order metadata sent. Sending image in chunks...', 'info');
        await sendDataInChunks(connToShop, designDataUrl, orderDetails.idempotencyKey || payloadToShop.idempotencyKey );
      } else {
        payloadToShop.designDataUrl = designDataUrl; // Send it as part of JSON
        console.log("[CLIENT] Sending payload (with designDataUrl embedded) to print shop via PeerJS. designDataUrl.length:", designDataUrl ? designDataUrl.length : 'N/A', "Total payload size (approx string length):", JSON.stringify(payloadToShop).length);
        if (JSON.stringify(payloadToShop).length > 16000) {
             console.warn("[CLIENT] Payload to shop is large even without chunking. This might still fail for very large metadata or small threshold.");
        }
        connToShop.send(payloadToShop);
      }

      showPaymentStatus('Order sent. Waiting for print shop confirmation...', 'info');

    } catch (error) {
      console.error("[CLIENT] Error during payment form submission:", error);
      showPaymentStatus(`Error: ${error.message}`, 'error');
    }
}

function updateEditingButtonsState(disabled) {
    const editingButtonElements = [
        rotateLeftBtnEl, rotateRightBtnEl, resizeBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl
    ];
    const disabledClasses = ['opacity-50', 'cursor-not-allowed'];
    editingButtonElements.forEach(button => {
        if (button) {
            button.disabled = disabled;
            if (disabled) { button.classList.add(...disabledClasses); }
            else { button.classList.remove(...disabledClasses); }
        }
    });
    if (resizeInputEl) {
        resizeInputEl.disabled = disabled;
        if (disabled) { resizeInputEl.classList.add(...disabledClasses); }
        else { resizeInputEl.classList.remove(...disabledClasses); }
    }
    const textControlsContainer = document.getElementById('text-editing-controls');
    if (textControlsContainer) {
        const textToolInputs = textControlsContainer.querySelectorAll('input, select, button');
        textToolInputs.forEach(input => {
            if (input) {
                input.disabled = disabled;
                if (disabled) { input.classList.add(...disabledClasses); }
                else { input.classList.remove(...disabledClasses); }
            }
        });
    }
    if (designMarginNote) designMarginNote.style.display = disabled ? 'none' : 'block';
}

async function sendDataInChunks(connection, dataString, dataId) {
    if (!connection || !connection.open) {
        console.error("[CLIENT] PeerJS connection not open. Cannot send data in chunks.");
        showPaymentStatus("Connection error: Cannot send image data.", "error");
        return;
    }
    console.log(`[CLIENT] Starting to send data in chunks for ID: ${dataId}. Total size: ${dataString.length}. Chunk size: ${IMAGE_CHUNK_SIZE}`);
    const totalChunks = Math.ceil(dataString.length / IMAGE_CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
        const chunk = dataString.substring(i * IMAGE_CHUNK_SIZE, (i + 1) * IMAGE_CHUNK_SIZE);
        const chunkPayload = {
            type: 'imageDataChunk',
            dataId: dataId,
            chunkIndex: i,
            chunkData: chunk, // Actual chunk data
            totalChunks: totalChunks,
            isLastChunk: (i === totalChunks - 1)
        };
        // Log the metadata of the chunk, not the (potentially very long) chunkData itself
        const chunkMetadataForLog = { ...chunkPayload, chunkData: `(chunk data length: ${chunk.length})` };
        console.log(`[CLIENT] Sending chunkPayload: ${JSON.stringify(chunkMetadataForLog)}`);

        try {
            connection.send(chunkPayload);
            // console.log(`[CLIENT] Sent chunk ${i + 1}/${totalChunks} for ID: ${dataId}. Chunk size: ${chunk.length}`);
            // A small delay might help prevent overwhelming the receiver or the PeerJS internal buffers.
            // await new Promise(resolve => setTimeout(resolve, 50)); // Optional delay
        } catch (error) {
            console.error(`[CLIENT] Error sending chunk ${i + 1} for ID ${dataId}:`, error);
            showPaymentStatus(`Error sending image chunk ${i+1}. Please try again.`, "error");
            connection.send({ type: 'imageDataAbort', dataId: dataId, message: `Failed to send chunk ${i+1}`});
            return; // Stop sending further chunks
        }
    }
    console.log(`[CLIENT] All ${totalChunks} chunks sent successfully for ID: ${dataId}`);
    showPaymentStatus('Image data sent successfully.', 'success');
}


function showPaymentStatus(message, type = 'info') {
    if (!paymentStatusContainer) {
        console.error("Payment status container not found. Message:", message); return;
    }
    paymentStatusContainer.textContent = message;
    paymentStatusContainer.style.visibility = 'visible';
    paymentStatusContainer.classList.remove('payment-success', 'payment-error', 'payment-info');
    if (type === 'success') { paymentStatusContainer.classList.add('payment-success'); }
    else if (type === 'error') { paymentStatusContainer.classList.add('payment-error'); }
    else { paymentStatusContainer.classList.add('payment-info'); }
}

function handleFileChange(event) {
    const files = event.target.files;
    if (files.length === 0) {
        showPaymentStatus('No file selected. Please choose an image file.', 'error');
        originalImage = null; updateEditingButtonsState(true);
        if(ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        if(fileInputGlobalRef) fileInputGlobalRef.value = '';
        if(fileNameDisplayEl) fileNameDisplayEl.textContent = '';
        if (designMarginNote) designMarginNote.style.display = 'none';
        return;
    }
    const file = files[0];
    if (file && file.type.startsWith('image/')) {
        if(fileNameDisplayEl) fileNameDisplayEl.textContent = file.name;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                originalImage = img; updateEditingButtonsState(false);
                if (paymentStatusContainer && (paymentStatusContainer.textContent.includes('Please select an image file') || paymentStatusContainer.textContent.includes('No file selected') || paymentStatusContainer.textContent.includes('Invalid file type'))) {
                   showPaymentStatus('Image loaded successfully.', 'success');
                }
                const maxWidth = 500; const maxHeight = 400;
                let newWidth = img.width; let newHeight = img.height;
                if (newWidth > maxWidth) { const r = maxWidth / newWidth; newWidth = maxWidth; newHeight *= r; }
                if (newHeight > maxHeight) { const r = maxHeight / newHeight; newHeight = maxHeight; newWidth *= r; }
                if(canvas && ctx) {
                    canvas.width = newWidth; canvas.height = newHeight;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
                }
                if (designMarginNote) designMarginNote.style.display = 'block';
            };
            img.onerror = () => {
                showPaymentStatus('Error loading image data.', 'error');
                originalImage = null; updateEditingButtonsState(true);
                if(ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
                if(fileInputGlobalRef) fileInputGlobalRef.value = '';
                if(fileNameDisplayEl) fileNameDisplayEl.textContent = '';
                if (designMarginNote) designMarginNote.style.display = 'none';
            };
            img.src = reader.result;
        };
        reader.onerror = () => {
            showPaymentStatus('Error reading file.', 'error');
            originalImage = null; updateEditingButtonsState(true);
            if(ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
            if(fileInputGlobalRef) fileInputGlobalRef.value = '';
            if(fileNameDisplayEl) fileNameDisplayEl.textContent = '';
            if (designMarginNote) designMarginNote.style.display = 'none';
        };
        reader.readAsDataURL(file);
    } else {
        showPaymentStatus('Invalid file type. Please select an image file.', 'error');
        originalImage = null; updateEditingButtonsState(true);
        if(ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        if(fileInputGlobalRef) fileInputGlobalRef.value = '';
        if(fileNameDisplayEl) fileNameDisplayEl.textContent = '';
        if (designMarginNote) designMarginNote.style.display = 'none';
    }
}

// Required in SCA Mandated Regions: Learn more at https://developer.squareup.com/docs/sca-overview
async function verifyBuyer(payments, token, billingContact) { // Modified signature
  const verificationDetails = {
    amount: "1.00", // As per requirement
    billingContact: billingContact, // Use passed billingContact
    currencyCode: "USD", // As per requirement
    intent: "CHARGE", // As per requirement
  };

  const verificationResults = await payments.verifyBuyer(
    token,
    verificationDetails
  );
  return verificationResults.token;
}


// Get the form element
// var form = document.getElementById('payment-form'); // This is already handled by paymentFormGlobalRef

// Attach the submit event handler
// form.addEventListener('submit', async function(event) { // This is already handled by paymentFormGlobalRef
// Made async // This logic is within handlePaymentFormSubmit
// event.preventDefault(); // Prevent default form submission

// const paymentStatusContainer = document.getElementById('payment-status-container'); // Already global
// const ipfsLinkContainer = document.getElementById('ipfsLinkContainer'); // Already global

  // Reset classes and apply base style, then specific status style
  // const baseStatusClasses = 'mb-4 p-3 rounded-md text-sm text-white'; // Defined in showPaymentStatus
  // const baseIpfsClasses = 'mt-6 p-4 border rounded-md text-sm bg-gray-50 shadow'; // Styles are applied directly or via classes

  // Initial UI Update
  // if (ipfsLinkContainer) { // This logic is within handlePaymentFormSubmit
  //   ipfsLinkContainer.innerHTML = '';
  //   ipfsLinkContainer.className = baseIpfsClasses; // Reset to base
  // }
  // paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`; // Handled by showPaymentStatus
  // paymentStatusContainer.textContent = 'Processing payment...';
  // paymentStatusContainer.style.visibility = 'visible';


  // try { // This logic is within handlePaymentFormSubmit
    // Billing Contact from form fields
    // const billingContact = {
    //   givenName: document.getElementById('firstName').value || undefined,
    //   familyName: document.getElementById('lastName').value || undefined,
    //   email: document.getElementById('email').value || undefined,
    //   phone: document.getElementById('phone').value || undefined,
    //   addressLines: [document.getElementById('address').value || '123 Main St'], // Default if empty
    //   city: document.getElementById('city').value || undefined,
    //   state: document.getElementById('state').value || 'CA', // Default if empty
    //   postalCode: document.getElementById('postalCode').value || '90210', // Added postalCode
    //   countryCode: "US", // Hardcoded as per requirement
    // };

    // Check for required billing contact fields for Square
    // Added postalCode to the check.
    // if (!billingContact.givenName || !billingContact.familyName || !billingContact.email || !billingContact.addressLines[0] || !billingContact.city || !billingContact.state || !billingContact.postalCode) {
    //     throw new Error("Please fill in all required billing details: First Name, Last Name, Email, Address, City, State, and Postal Code.");
    // }

    // paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`; // Handled by showPaymentStatus
    // paymentStatusContainer.textContent = 'Tokenizing card...';
    // const token = await tokenize(card); // Assuming 'card' is globally available and initialized

    // paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`; // Handled by showPaymentStatus
    // paymentStatusContainer.textContent = 'Card tokenized. Verifying buyer...';
    // console.log("Billing Contact being sent to verifyBuyer:", JSON.stringify(billingContact, null, 2)); // Added console.log
    // const verificationToken = await verifyBuyer(payments, token, billingContact); // Assuming 'payments' is globally available

    // paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`; // Handled by showPaymentStatus
    // paymentStatusContainer.textContent = 'Buyer verified. Creating payment (mocked)...';
    // Mock createPayment call
    // console.log("Simulating createPayment with token:", token, "and verificationToken:", verificationToken);
    // const mockPaymentResult = { success: true, message: "Payment processed successfully (mocked)." }; // Mocked result

    // if (mockPaymentResult.success) {
    //   paymentStatusContainer.className = `${baseStatusClasses} bg-green-500`; // Handled by showPaymentStatus
    //   paymentStatusContainer.textContent = mockPaymentResult.message;

      // --- IPFS UPLOAD LOGIC (Nested) ---
      // canvas and ctx are assumed to be globally available
      // let canvasHasContent = false;
      // try {
      //   canvasHasContent = ctx.getImageData(0, 0, 1, 1).data[3] > 0;
      // } catch (e) {
        // This can happen if canvas is blank or too small, or context is lost.
        // console.warn("Could not verify canvas content via getImageData:", e.message);
        // canvasHasContent = !!originalImage; // Fallback to checking if originalImage was ever loaded
      // }


      // if (originalImage && canvasHasContent) { // Check if an original image was loaded and canvas likely has content
        // if(ipfsLinkContainer) {
            // ipfsLinkContainer.className = `${baseIpfsClasses} text-blue-700`;
            // ipfsLinkContainer.innerHTML = 'Processing image for IPFS upload...';
        // }

        // canvas.toBlob(async (blob) => {
        //   if (blob) {
        //     try {
        //       if(ipfsLinkContainer) {
        //         ipfsLinkContainer.className = `${baseIpfsClasses} text-blue-700`;
        //         ipfsLinkContainer.innerHTML = 'Uploading to IPFS...';
        //       }
        //       const ipfsFormData = new FormData();
        //       const fileName = `edited_image_${Date.now()}.png`;
        //       ipfsFormData.append('file', blob, fileName);

        //       const response = await fetch('https://ipfs.infura.io:5001/api/v0/add', {
        //         method: 'POST',
        //         body: ipfsFormData,
        //       });

        //       if (!response.ok) {
        //         const errorText = await response.text();
        //         throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
        //       }

        //       const result = await response.json();
        //       const hash = result.Hash;
        //       console.log('IPFS Hash:', hash);
        //       if(ipfsLinkContainer) {
        //         ipfsLinkContainer.className = `${baseIpfsClasses} text-green-700`;
        //         ipfsLinkContainer.innerHTML = `Successfully uploaded to IPFS! <br>Hash: ${hash} <br>View: <a href="https://ipfs.io/ipfs/${hash}" target="_blank" class="text-indigo-600 hover:text-indigo-800 underline">https://ipfs.io/ipfs/${hash}</a>`;
        //       }

        //     } catch (ipfsError) {
        //       console.error('Error uploading to IPFS:', ipfsError);
        //       if(ipfsLinkContainer) {
        //         ipfsLinkContainer.className = `${baseIpfsClasses} text-red-700`;
        //         ipfsLinkContainer.textContent = `Error uploading to IPFS: ${ipfsError.message}`;
        //       }
        //     }
        //   } else {
        //     console.error('Failed to get blob from canvas for IPFS upload.');
        //     if(ipfsLinkContainer) {
        //         ipfsLinkContainer.className = `${baseIpfsClasses} text-red-700`;
        //         ipfsLinkContainer.textContent = 'Could not prepare image for upload (failed to get blob).';
        //     }
        //   }
        // }, 'image/png');
      // } else {
        // if(ipfsLinkContainer) {
            // ipfsLinkContainer.className = baseIpfsClasses; // Reset to base, text will be default
            // ipfsLinkContainer.textContent = 'No image to upload to IPFS or canvas is blank.';
        // }
      // }
    // } else {
      // Mock payment failed
      // paymentStatusContainer.className = `${baseStatusClasses} bg-red-500`; // Handled by showPaymentStatus
      // paymentStatusContainer.textContent = mockPaymentResult.message || "Payment processing failed (mocked).";
    // }

  // } catch (error) { // This logic is within handlePaymentFormSubmit
    // Catch errors from tokenization, verification, or other parts of the try block
    // console.error("Payment processing error:", error);
    // paymentStatusContainer.className = `${baseStatusClasses} bg-red-500`; // Handled by showPaymentStatus
    // paymentStatusContainer.textContent = `Error: ${error.message}`;
  // }
// }); // End of duplicated form event listener

// Image loading and display logic
// const fileInput = document.getElementById('file'); // Already global fileInputGlobalRef
// const canvas = document.getElementById('imageCanvas'); // Already global canvas
// const ctx = canvas.getContext('2d'); // Already global ctx
// let originalImage = null; // Already global originalImage
// Editing control buttons
// const editingButtons = [ // This is handled by updateEditingButtonsState using individual element IDs
//     document.getElementById('rotateLeftBtn'),
//     document.getElementById('rotateRightBtn'),
//     document.getElementById('resizeBtn'),
//     document.getElementById('startCropBtn'),
//     document.getElementById('grayscaleBtn'),
//     document.getElementById('sepiaBtn')
// ];
// const resizeInput = document.getElementById('resizeInput'); // Already global resizeInputEl


// function updateEditingButtonsState(disabled) { // This function is already defined earlier
//     const disabledClasses = ['opacity-50', 'cursor-not-allowed'];
//     editingButtons.forEach(button => {
//         if (button) {
//             button.disabled = disabled;
//             if (disabled) {
//                 button.classList.add(...disabledClasses);
//             } else {
//                 button.classList.remove(...disabledClasses);
//             }
//         }
//     });
//     if (resizeInput) {
//         resizeInput.disabled = disabled;
//         if (disabled) {
//             resizeInput.classList.add(...disabledClasses);
//         } else {
//             resizeInput.classList.remove(...disabledClasses);
//         }
//     }
// }
// Initially disable buttons
// updateEditingButtonsState(true); // This is called in BootStrap

// Helper to display messages in paymentStatusContainer
// function showPaymentStatus(message, type = 'info') { // This function is already defined earlier
//     const container = document.getElementById('payment-status-container');
//     const baseClasses = 'mb-4 p-3 rounded-md text-sm text-white';
//     let colorClass = 'bg-blue-500'; // Default to info
//     if (type === 'success') colorClass = 'bg-green-500';
//     else if (type === 'error') colorClass = 'bg-red-500';

//     container.className = `${baseClasses} ${colorClass}`;
//     container.textContent = message;
//     container.style.visibility = 'visible';
// }

// fileInput.addEventListener('change', (event) => { // This event listener is already on fileInputGlobalRef
    // const paymentStatusContainer = document.getElementById('payment-status-container');
    // const files = event.target.files;

    // if (files.length === 0) {
    //     showPaymentStatus('No file selected. Please choose an image file.', 'error');
    //     originalImage = null;
    //     updateEditingButtonsState(true);
    //     ctx.clearRect(0, 0, canvas.width, canvas.height);
    //     fileInput.value = ''; // Clear the file input
    //     return;
    // }

    // const file = files[0];

    // if (file && file.type.startsWith('image/')) {
    //     const reader = new FileReader();
    //     reader.onload = () => {
    //         const img = new Image();
    //         img.onload = () => {
    //             originalImage = img;
    //             updateEditingButtonsState(false);
    //             if (paymentStatusContainer.textContent.includes('Please select an image file') || paymentStatusContainer.textContent.includes('No file selected') || paymentStatusContainer.textContent.includes('Invalid file type')) {
    //                 paymentStatusContainer.textContent = 'Image loaded successfully.';
    //                 paymentStatusContainer.className = 'mb-4 p-3 rounded-md text-sm text-white bg-green-500';
                    // Optional: hide after a few seconds
                    // setTimeout(() => { paymentStatusContainer.style.visibility = 'hidden'; }, 3000);
                // } else {
                     // If there was no error message related to file selection, don't show success, or keep existing message.
                // }
    //             ctx.clearRect(0, 0, canvas.width, canvas.height);
    //             const hRatio = canvas.width / img.width;
    //             const vRatio = canvas.height / img.height;
    //             const ratio = Math.min(hRatio, vRatio);
    //             const centerShift_x = (canvas.width - img.width * ratio) / 2;
    //             const centerShift_y = (canvas.height - img.height * ratio) / 2;
    //             ctx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height,
    //                           centerShift_x, centerShift_y, originalImage.width * ratio, originalImage.height * ratio);
    //         };
    //         img.onerror = () => {
    //             showPaymentStatus('Error loading image data. The file may be corrupt or not a valid image.', 'error');
    //             originalImage = null;
    //             updateEditingButtonsState(true);
    //             ctx.clearRect(0, 0, canvas.width, canvas.height);
    //             fileInput.value = ''; // Clear the file input
    //         };
    //         img.src = reader.result;
    //     };
    //     reader.onerror = () => {
    //         showPaymentStatus('Error reading file. Please try again.', 'error');
    //         originalImage = null;
    //         updateEditingButtonsState(true);
    //         ctx.clearRect(0, 0, canvas.width, canvas.height);
    //         fileInput.value = ''; // Clear the file input
    //     };
    //     reader.readAsDataURL(file);
    // } else {
    //     showPaymentStatus('Invalid file type. Please select an image file (e.g., PNG, JPG).', 'error');
    //     originalImage = null;
    //     updateEditingButtonsState(true);
    //     ctx.clearRect(0, 0, canvas.width, canvas.height);
    //     fileInput.value = ''; // Clear the file input
    // }
// });

// --- Image Editing Functions ---

// Function to redraw the original image (useful for reverting or complex operations)
function redrawOriginalImage() {
    if (!originalImage || !canvas || !ctx) {
        showPaymentStatus('No image loaded or canvas not ready to redraw.', 'error'); return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hRatio = canvas.width / originalImage.width; const vRatio = canvas.height / originalImage.height;
    const ratio = Math.min(hRatio, vRatio);
    const centerShift_x = (canvas.width - originalImage.width * ratio) / 2;
    const centerShift_y = (canvas.height - originalImage.height * ratio) / 2;
    ctx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height, centerShift_x, centerShift_y, originalImage.width * ratio, originalImage.height * ratio);
    showPaymentStatus('Image reset to original.', 'info');
}

function rotateCanvasContentFixedBounds(angleDegrees) {
    if (!canvas || !ctx || (!originalImage && ctx.getImageData(0,0,1,1).data[3] === 0)) {
        showPaymentStatus('Please load an image or ensure canvas has content before rotating.', 'error'); return;
    }
    try { if (ctx.getImageData(0,0,1,1).data[3] === 0 && originalImage) { redrawOriginalImage(); } }
    catch (e) { console.warn("Could not verify canvas content for rotation via getImageData:", e.message); }

    const tempCanvas = document.createElement('canvas'); const tempCtx = tempCanvas.getContext('2d');
    let currentDataUrl;
    try { currentDataUrl = canvas.toDataURL(); }
    catch (e) { showPaymentStatus(`Could not get canvas data for rotation: ${e.message}. Try reloading the image.`, 'error'); return; }

    const imgToRotate = new Image();
    imgToRotate.onload = () => {
        const w = canvas.width; const h = canvas.height;
        const newCanvasWidth = (angleDegrees === 90 || angleDegrees === -90) ? h : w;
        const newCanvasHeight = (angleDegrees === 90 || angleDegrees === -90) ? w : h;
        tempCanvas.width = newCanvasWidth; tempCanvas.height = newCanvasHeight;
        tempCtx.translate(newCanvasWidth / 2, newCanvasHeight / 2);
        tempCtx.rotate(angleDegrees * Math.PI / 180);
        tempCtx.drawImage(imgToRotate, -w / 2, -h / 2, w, h);
        canvas.width = newCanvasWidth; canvas.height = newCanvasHeight;
        ctx.clearRect(0,0,canvas.width, canvas.height); ctx.drawImage(tempCanvas, 0,0);
    };
    imgToRotate.onerror = () => { showPaymentStatus('Error loading temporary image for rotation.', 'error'); };
    imgToRotate.src = currentDataUrl;
}

document.getElementById('rotateLeftBtn').addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
document.getElementById('rotateRightBtn').addEventListener('click', () => rotateCanvasContentFixedBounds(90));
function applyGrayscaleFilter() {
    if (!canvas || !ctx || (!originalImage && ctx.getImageData(0,0,1,1).data[3] === 0)) { showPaymentStatus("Please load an image first to apply grayscale.", 'error'); return; }
    try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
        }
        ctx.putImageData(imageData, 0, 0);
    } catch (e) { showPaymentStatus(`Error applying grayscale: ${e.message}. Canvas may be tainted.`, 'error'); }
}

function applySepiaFilter() {
    if (!canvas || !ctx || (!originalImage && ctx.getImageData(0,0,1,1).data[3] === 0)) { showPaymentStatus("Please load an image first to apply sepia.", 'error'); return; }
    try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
            data[i+1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
            data[i+2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        }
        ctx.putImageData(imageData, 0, 0);
    } catch (e) { showPaymentStatus(`Error applying sepia: ${e.message}. Canvas may be tainted.`, 'error'); }
}

function handleResize() {
    if (!canvas || !ctx || (!originalImage && ctx.getImageData(0,0,1,1).data[3] === 0)) {
        showPaymentStatus("Please load an image first before resizing.", 'error'); return;
    }
    let currentCanvasDataUrl;
    try { currentCanvasDataUrl = canvas.toDataURL(); }
    catch (e) { showPaymentStatus(`Cannot resize: ${e.message}. Canvas may be tainted. Try reloading the original image.`, 'error'); return; }

    const imgToResize = new Image();
    imgToResize.onload = () => {
        if (!resizeInputEl) { console.error("Resize input element not found for handleResize"); return; }
        const percentageText = resizeInputEl.value;
        if (!percentageText.endsWith('%')) { showPaymentStatus("Resize input must be a percentage (e.g., '50%').", 'error'); return; }
        const percentage = parseFloat(percentageText.replace('%', ''));
        if (isNaN(percentage) || percentage <= 0) { showPaymentStatus("Please enter a valid positive percentage for resize.", 'error'); return; }
        const newWidth = imgToResize.width * (percentage / 100); const newHeight = imgToResize.height * (percentage / 100);
        if (newWidth <= 0 || newHeight <= 0 || newWidth > 10000 || newHeight > 10000) { showPaymentStatus("Calculated resize dimensions are invalid or too large.", 'error'); return; }
        canvas.width = newWidth; canvas.height = newHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(imgToResize, 0, 0, newWidth, newHeight);
        if(resizeInputEl) resizeInputEl.value = '';
        showPaymentStatus(`Image resized to ${percentage}%.`, 'success');
    };
    imgToResize.onerror = () => showPaymentStatus('Error preparing image for resize.', 'error');
    imgToResize.src = currentCanvasDataUrl;
}

function handleCrop() {
    if (!canvas || !ctx || (!originalImage && ctx.getImageData(0,0,1,1).data[3] === 0)) {
         showPaymentStatus("Please load an image or ensure canvas has content before cropping.", 'error'); return;
    }
    let currentCanvasDataUrl;
    try { currentCanvasDataUrl = canvas.toDataURL(); }
    catch (e) { showPaymentStatus(`Cannot crop: ${e.message}. Canvas may be tainted. Try reloading the original image.`, 'error'); return; }

    const imgToCrop = new Image();
    imgToCrop.onload = () => {
        const cropWidth = imgToCrop.width / 2; const cropHeight = imgToCrop.height / 2;
        const cropX = imgToCrop.width / 4; const cropY = imgToCrop.height / 4;
        if (cropWidth <= 0 || cropHeight <= 0) { showPaymentStatus("Current image is too small to perform this crop.", 'error'); return; }
        canvas.width = cropWidth; canvas.height = cropHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgToCrop, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
        showPaymentStatus("Image cropped to central 50%.", 'success');
    };
    imgToCrop.onerror = () => showPaymentStatus('Error preparing image for crop.', 'error');
    imgToCrop.src = currentCanvasDataUrl;
}
