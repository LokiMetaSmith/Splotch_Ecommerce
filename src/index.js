// index.js

const appId = "sandbox-sq0idb-tawTw_Vl7VGYI6CZfKEshA";
const locationId = "LTS82DEX24XR0";
const serverUrl = 'http://localhost:3000'; // Define server URL once

// Declare globals for SDK objects and key DOM elements
let payments, card, csrfToken;
let originalImage = null;
let canvas, ctx;

let textInput, textSizeInput, textColorInput, addTextBtn, textFontFamilySelect;
let stickerMaterialSelect, designMarginNote, stickerQuantityInput, calculatedPriceDisplay;
let paymentStatusContainer, ipfsLinkContainer, fileInputGlobalRef, paymentFormGlobalRef, fileNameDisplayEl;
let rotateLeftBtnEl, rotateRightBtnEl, resizeInputEl, resizeBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl;

let currentOrderAmountCents = 0;

// --- Main Application Setup ---
async function BootStrap() {
    // Assign DOM elements
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
    ipfsLinkContainer = document.getElementById('ipfsLinkContainer'); // This might be deprecated if IPFS is handled server-side
    fileInputGlobalRef = document.getElementById('file');
    fileNameDisplayEl = document.getElementById('fileNameDisplay');
    paymentFormGlobalRef = document.getElementById('payment-form');

    rotateLeftBtnEl = document.getElementById('rotateLeftBtn');
    rotateRightBtnEl = document.getElementById('rotateRightBtn');
    resizeInputEl = document.getElementById('resizeInput');
    resizeBtnEl = document.getElementById('resizeBtn');
    startCropBtnEl = document.getElementById('startCropBtn');
    grayscaleBtnEl = document.getElementById('grayscaleBtn');
    sepiaBtnEl = document.getElementById('sepiaBtn');

    // Fetch CSRF token
    await fetchCsrfToken();

    // Initialize Square Payments SDK
    console.log(`[CLIENT] Initializing Square SDK with appId: ${appId}, locationId: ${locationId}`);
    try {
        if (!window.Square || !window.Square.payments) {
            throw new Error("Square SDK is not loaded.");
        }
        payments = window.Square.payments(appId, locationId);
        card = await initializeCard(payments);
    } catch (error) {
        showPaymentStatus(`Failed to initialize payments: ${error.message}`, 'error');
        console.error("[CLIENT] Failed to initialize Square payments SDK:", error);
        return;
    }

    // Attach event listeners
    if (stickerQuantityInput) {
        calculateAndUpdatePrice();
        stickerQuantityInput.addEventListener('input', calculateAndUpdatePrice);
        stickerQuantityInput.addEventListener('change', calculateAndUpdatePrice);
    }
    if (stickerMaterialSelect) {
        stickerMaterialSelect.addEventListener('change', calculateAndUpdatePrice);
    }
    if (addTextBtn) {
        addTextBtn.addEventListener('click', handleAddText);
    }
    if (rotateLeftBtnEl) rotateLeftBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
    if (rotateRightBtnEl) rotateRightBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(90));
    if (grayscaleBtnEl) grayscaleBtnEl.addEventListener('click', applyGrayscaleFilter);
    if (sepiaBtnEl) sepiaBtnEl.addEventListener('click', applySepiaFilter);
    if (resizeBtnEl) resizeBtnEl.addEventListener('click', handleResize);
    if (startCropBtnEl) startCropBtnEl.addEventListener('click', handleCrop);
    if (fileInputGlobalRef) {
        fileInputGlobalRef.addEventListener('change', handleFileChange);
    }

    // Add drag-and-drop and paste listeners to the canvas
    if (canvas) {
        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            canvas.classList.add('border-dashed', 'border-2', 'border-blue-500');
        });

        canvas.addEventListener('dragleave', (e) => {
            e.preventDefault();
            canvas.classList.remove('border-dashed', 'border-2', 'border-blue-500');
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            canvas.classList.remove('border-dashed', 'border-2', 'border-blue-500');
            const file = e.dataTransfer.files[0];
            if (file) {
                loadFileAsImage(file);
            }
        });
    }

    window.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    loadFileAsImage(file);
                }
            }
        }
    });

    // Set up the payment form
    console.log('[CLIENT] BootStrap: Checking paymentFormGlobalRef before attaching listener. paymentFormGlobalRef:', paymentFormGlobalRef);
    if (paymentFormGlobalRef) {
        console.log('[CLIENT] BootStrap: paymentFormGlobalRef found. Attaching submit event listener.');
        paymentFormGlobalRef.addEventListener('submit', handlePaymentFormSubmit);
    } else {
        console.error("[CLIENT] BootStrap: Payment form with ID 'payment-form' not found. Payments will not work.");
        showPaymentStatus("Payment form is missing. Cannot process payments.", "error");
    }

    updateEditingButtonsState(!originalImage);
    if (designMarginNote) designMarginNote.style.display = 'none';
}

// --- Main execution ---
document.addEventListener('DOMContentLoaded', () => {
    BootStrap();
    // Check if the Square SDK was blocked after 2 seconds
    setTimeout(() => {
        if (typeof Square === 'undefined') {
            console.error('[CLIENT] Square SDK appears to be blocked.');
            // Function to show a warning message to the user
            showAdBlockerWarning();
        }
    }, 2000);
});

function showAdBlockerWarning() {
    // For example, make a hidden div visible
    const warningBanner = document.getElementById('adblock-warning');
    if (warningBanner) {
        warningBanner.style.display = 'block';
    }
}


// --- Pricing Logic ---
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
    }
}

function formatPrice(amountInCents) {
    const amountInDollars = amountInCents / 100;
    return amountInDollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// --- Square SDK Functions ---
async function initializeCard(paymentsSDK) {
    if (!paymentsSDK) throw new Error("Payments SDK not ready for card initialization.");
    const cardInstance = await paymentsSDK.card();
    await cardInstance.attach("#card-container");
    return cardInstance;
}

async function tokenize(paymentMethod, verificationDetails) {
    if (!paymentMethod) throw new Error("Card payment method not initialized.");
    const tokenResult = await paymentMethod.tokenize(verificationDetails);
    if (tokenResult.status === "OK") {
        if (!tokenResult.token) throw new Error("Tokenization succeeded but no token was returned.");
        return tokenResult.token;
    }
    let errorMessage = `Tokenization failed: ${tokenResult.status}`;
    if (tokenResult.errors) {
        errorMessage += ` ${JSON.stringify(tokenResult.errors)}`;
    }
    throw new Error(errorMessage);
}

// --- CSRF Token Fetching ---
async function fetchCsrfToken() {
    try {
        const response = await fetch(`${serverUrl}/api/csrf-token`, {
            credentials: 'include', // Important for cookies
        });
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        const data = await response.json();
        if (!data.csrfToken) {
            throw new Error("CSRF token not found in server response");
        }
        csrfToken = data.csrfToken;
        console.log('[CLIENT] CSRF Token fetched and stored.');
    } catch (error) {
        console.error('[CLIENT] Error fetching CSRF token:', error);
        showPaymentStatus('A security token could not be loaded. Please refresh the page to continue.', 'error');
    }
}


// --- Form Submission Logic ---
async function handlePaymentFormSubmit(event) {
    console.log('[CLIENT] handlePaymentFormSubmit triggered.');
    event.preventDefault();

    showPaymentStatus('Processing order...', 'info');

    // Ensure there is an image to submit
    if (!originalImage) {
        showPaymentStatus('Please upload a sticker design image before submitting.', 'error');
        return;
    }

    // Ensure CSRF token is available
    if (!csrfToken) {
        showPaymentStatus('Cannot submit form. A required security token is missing. Please refresh the page.', 'error');
        console.error('[CLIENT] Aborting submission: CSRF token is missing.');
        return;
    }

    const email = document.getElementById('email').value;
    if (!email) {
        showPaymentStatus('Please enter an email address to proceed.', 'error');
        return;
    }


    try {
        // 0. Get temporary auth token
        showPaymentStatus('Issuing temporary auth token...', 'info');
        const authResponse = await fetch(`${serverUrl}/api/auth/issue-temp-token`, {
            method: 'POST',
            credentials: 'include', // Important for cookies
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ email }),
        });

        if (!authResponse.ok) {
            const errorText = await authResponse.text();
            throw new Error(`Could not issue a temporary authentication token. Server responded with: ${errorText}`);
        }
        const { token: tempAuthToken } = await authResponse.json();
        if (!tempAuthToken) {
            throw new Error('Temporary authentication token was not received.');
        }
        console.log('[CLIENT] Temporary auth token received.');


        // --- NEW: Build verificationDetails object ---
        const billingContact = {
            givenName: document.getElementById('firstName').value,
            familyName: document.getElementById('lastName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            addressLines: [document.getElementById('address').value],
            city: document.getElementById('city').value,
            state: document.getElementById('state').value,
            postalCode: document.getElementById('postalCode').value,
            countryCode: "US",
        };

        const verificationDetails = {
            amount: (currentOrderAmountCents / 100).toFixed(2), // Must be a string
            currencyCode: 'USD',
            intent: 'CHARGE',
            billingContact: billingContact,
            customerInitiated: true,
            sellerKeyedIn: false,
        };
        // --- END NEW ---

        // 1. Tokenize the card with verification details
        showPaymentStatus('Securing card details...', 'info');
        console.log('[CLIENT] Tokenizing card with verification details.');

        // UPDATED: Pass the new verificationDetails object to tokenize
        const sourceId = await tokenize(card, verificationDetails);

        console.log('[CLIENT] Tokenization successful. Nonce (sourceId):', sourceId);

        // 2. Get image data from canvas as a Blob
        const designImageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!designImageBlob) {
            throw new Error("Could not get image data from canvas.");
        }

        // 3. Create FormData to send to the server
        const formData = new FormData();
        const orderDetails = {
            quantity: stickerQuantityInput ? parseInt(stickerQuantityInput.value, 10) : 0,
            material: stickerMaterialSelect ? stickerMaterialSelect.value : 'unknown',
            cutLineFileName: document.getElementById('cutLineFile')?.files[0]?.name || null,
        };

        formData.append('designImage', designImageBlob, 'design.png');
        formData.append('sourceId', sourceId);
        formData.append('amountCents', currentOrderAmountCents);
        formData.append('currency', 'USD');
        formData.append('orderDetails', JSON.stringify(orderDetails));
        formData.append('billingContact', JSON.stringify(billingContact));

        // 4. Submit the order to the server
        showPaymentStatus('Submitting order to server...', 'info');
        console.log('[CLIENT] Submitting order to server at /api/create-order');

        const response = await fetch(`${serverUrl}/api/create-order`, {
            method: 'POST',
            credentials: 'include', // Important for cookies
            headers: {
                'Authorization': `Bearer ${tempAuthToken}`,
                'X-CSRF-Token': csrfToken
            },
            body: formData, // No 'Content-Type' header needed; browser sets it for FormData
        });

        const responseData = await response.json();

        if (!response.ok) {
            // Check if the error is a CSRF token error, and if so, fetch a new one
            if (responseData.error && responseData.error.includes('csrf')) {
                 showPaymentStatus('Your security token has expired. Please try submitting again.', 'error');
                 console.warn('[CLIENT] CSRF token was invalid. Fetching a new one.');
                 await fetchCsrfToken(); // Fetch a new token for the next attempt
            }
            throw new Error(responseData.error || 'Failed to create order on server.');
        }

        console.log('[CLIENT] Order created successfully on server:', responseData);
        showPaymentStatus(`Order successfully placed! Order ID: ${responseData.order.orderId.substring(0, 8)}...`, 'success');

        // Optionally display IPFS link if server provides it
        if (responseData.order.designIpfsHash && ipfsLinkContainer) {
            ipfsLinkContainer.innerHTML = `Design IPFS Hash: ${responseData.order.designIpfsHash}`;
            ipfsLinkContainer.style.visibility = 'visible';
        }

    } catch (error) {
        console.error("[CLIENT] Error during payment form submission:", error);
        showPaymentStatus(`Error: ${error.message}`, 'error');
    }
}

// --- UI Helper Functions ---
function showPaymentStatus(message, type = 'info') {
    if (!paymentStatusContainer) {
        console.error("Payment status container not found. Message:", message);
        return;
    }
    paymentStatusContainer.textContent = message;
    paymentStatusContainer.style.visibility = 'visible';
    paymentStatusContainer.classList.remove('payment-success', 'payment-error', 'payment-info');
    if (type === 'success') {
        paymentStatusContainer.classList.add('payment-success');
    } else if (type === 'error') {
        paymentStatusContainer.classList.add('payment-error');
    } else {
        paymentStatusContainer.classList.add('payment-info');
    }
}

function updateEditingButtonsState(disabled) {
    const elements = [
        rotateLeftBtnEl, rotateRightBtnEl, resizeBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl,
        resizeInputEl, textInput, textSizeInput, textColorInput, addTextBtn, textFontFamilySelect
    ];
    const disabledClasses = ['opacity-50', 'cursor-not-allowed'];
    elements.forEach(el => {
        if (el) {
            el.disabled = disabled;
            if (disabled) el.classList.add(...disabledClasses);
            else el.classList.remove(...disabledClasses);
        }
    });
    if (designMarginNote) designMarginNote.style.display = disabled ? 'none' : 'block';
}

// --- Image Loading and Editing Functions ---
function handleFileChange(event) {
    const file = event.target.files[0];
    if (file) {
        loadFileAsImage(file);
    }
}

function loadFileAsImage(file) {
    if (!file || !file.type.startsWith('image/')) {
        showPaymentStatus('Invalid file type. Please select an image.', 'error');
        return;
    }
    if (fileNameDisplayEl) fileNameDisplayEl.textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            updateEditingButtonsState(false);
            showPaymentStatus('Image loaded successfully.', 'success');
            const maxWidth = 500, maxHeight = 400;
            let newWidth = img.width, newHeight = img.height;
            if (newWidth > maxWidth) { const r = maxWidth / newWidth; newWidth = maxWidth; newHeight *= r; }
            if (newHeight > maxHeight) { const r = maxHeight / newHeight; newHeight = maxHeight; newWidth *= r; }
            if (canvas && ctx) {
                canvas.width = newWidth;
                canvas.height = newHeight;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
            }
        };
        img.onerror = () => showPaymentStatus('Error loading image data.', 'error');
        img.src = reader.result;
    };
    reader.onerror = () => showPaymentStatus('Error reading file.', 'error');
    reader.readAsDataURL(file);
}

function handleAddText() {
    if (!canvas || !ctx || !originalImage) {
        showPaymentStatus('Please load an image before adding text.', 'error');
        return;
    }
    const text = textInput.value;
    const size = parseInt(textSizeInput.value, 10);
    const color = textColorInput.value;
    const font = textFontFamilySelect.value;
    if (!text.trim() || isNaN(size) || size <= 0) {
        showPaymentStatus('Please enter valid text and size.', 'error');
        return;
    }
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    showPaymentStatus(`Text "${text}" added.`, 'success');
}

function rotateCanvasContentFixedBounds(angleDegrees) {
    if (!canvas || !ctx || !originalImage) return;
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    const currentDataUrl = canvas.toDataURL();
    const imgToRotate = new Image();
    imgToRotate.onload = () => {
        const w = canvas.width, h = canvas.height;
        const newW = (angleDegrees === 90 || angleDegrees === -90) ? h : w;
        const newH = (angleDegrees === 90 || angleDegrees === -90) ? w : h;
        tempCanvas.width = newW; tempCanvas.height = newH;
        tempCtx.translate(newW / 2, newH / 2);
        tempCtx.rotate(angleDegrees * Math.PI / 180);
        tempCtx.drawImage(imgToRotate, -w / 2, -h / 2, w, h);
        canvas.width = newW; canvas.height = newH;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);
    };
    imgToRotate.src = currentDataUrl;
}

function applyGrayscaleFilter() {
    if (!canvas || !ctx || !originalImage) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
    }
    ctx.putImageData(imageData, 0, 0);
}

function applySepiaFilter() {
    if (!canvas || !ctx || !originalImage) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
        data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
        data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
    }
    ctx.putImageData(imageData, 0, 0);
}

function handleResize() {
    if (!canvas || !ctx || !originalImage) return;
    const currentCanvasDataUrl = canvas.toDataURL();
    const imgToResize = new Image();
    imgToResize.onload = () => {
        const percentageText = resizeInputEl.value;
        if (!percentageText.endsWith('%')) return;
        const percentage = parseFloat(percentageText.replace('%', ''));
        if (isNaN(percentage) || percentage <= 0) return;
        const newWidth = imgToResize.width * (percentage / 100);
        const newHeight = imgToResize.height * (percentage / 100);
        canvas.width = newWidth; canvas.height = newHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgToResize, 0, 0, newWidth, newHeight);
        if (resizeInputEl) resizeInputEl.value = '';
    };
    imgToResize.src = currentCanvasDataUrl;
}

function handleCrop() {
    if (!canvas || !ctx || !originalImage) return;
    const currentCanvasDataUrl = canvas.toDataURL();
    const imgToCrop = new Image();
    imgToCrop.onload = () => {
        const cropWidth = imgToCrop.width / 2;
        const cropHeight = imgToCrop.height / 2;
        const cropX = imgToCrop.width / 4;
        const cropY = imgToCrop.height / 4;
        canvas.width = cropWidth; canvas.height = cropHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgToCrop, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    };
    imgToCrop.src = currentCanvasDataUrl;
}
