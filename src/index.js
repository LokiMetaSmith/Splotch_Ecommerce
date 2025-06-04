// index.js

const appId = "sandbox-sq0idb-nbW_Oje9Dm0L5YvQ7WP2ow";
const locationId = "LTS82DEX24XR0";

// Declare globals for SDK objects and key DOM elements that might be needed across functions
let payments, card; // Square SDK objects
let originalImage = null;
let canvas, ctx; // Canvas elements

// Declare other DOM element variables; will be assigned in BootStrap
let textInput, textSizeInput, textColorInput, addTextBtn, textFontFamilySelect;
let stickerMaterialSelect, designMarginNote, stickerQuantityInput, calculatedPriceDisplay;
let paymentStatusContainer, ipfsLinkContainer, fileInputGlobalRef, paymentFormGlobalRef;
let rotateLeftBtnEl, rotateRightBtnEl, resizeInputEl, resizeBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl;

let currentOrderAmountCents = 0;

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
    paymentFormGlobalRef = document.getElementById('payment-form');

    rotateLeftBtnEl = document.getElementById('rotateLeftBtn');
    rotateRightBtnEl = document.getElementById('rotateRightBtn');
    resizeInputEl = document.getElementById('resizeInput');
    resizeBtnEl = document.getElementById('resizeBtn');
    startCropBtnEl = document.getElementById('startCropBtn');
    grayscaleBtnEl = document.getElementById('grayscaleBtn');
    sepiaBtnEl = document.getElementById('sepiaBtn');

    console.log(`Initializing Square SDK with appId: ${appId}, locationId: ${locationId}`);
    try {
        if (!window.Square || !window.Square.payments) {
            throw new Error("Square SDK (window.Square or window.Square.payments) is not loaded.");
        }
        payments = window.Square.payments(appId, locationId);
      } catch (error) {
        showPaymentStatus(`Failed to initialize Square payments SDK: ${error.message}`, 'error');
        console.error("Failed to initialize Square payments SDK:", error);
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

async function initializeCard(paymentsSDK) { // Renamed 'payments' to 'paymentsSDK' for clarity
  if (!paymentsSDK) {
    console.error("Square payments object not initialized before calling initializeCard.");
    throw new Error("Payments SDK not ready for card initialization.");
  }
  const cardInstance = await paymentsSDK.card();
  await cardInstance.attach("#card-container");
  return cardInstance; // This is the 'card' object used for tokenization
}

// ***** MODIFIED: createPayment no longer needs verificationToken *****
async function createPayment(token, amount, currency, orderDetails) {
  const body = JSON.stringify({
    locationId,
    sourceId: token, // This is the card nonce from card.tokenize()
    // verificationToken is NO LONGER SENT
    idempotencyKey: window.crypto.randomUUID(),
    amount: amount, // Amount in smallest currency unit (e.g., "100" for $1.00)
    currency: currency,
    orderDetails: orderDetails
  });
  console.log("Sending to /payment backend:", body); // Log what's sent to your backend

  const paymentResponse = await fetch("/payment", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });

  if (paymentResponse.ok) return paymentResponse.json();
  let errorBodyText = await paymentResponse.text();
  try {
    const errorJson = JSON.parse(errorBodyText);
    if (errorJson.errors && errorJson.errors.length > 0) {
      throw new Error(errorJson.errors.map(err => `${err.category} - ${err.code}: ${err.detail}`).join('; '));
    }
    throw new Error(errorBodyText);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('PAYMENT_METHOD_ERROR')) throw e;
    throw new Error(`Server error ${paymentResponse.status}: ${errorBodyText}`);
  }
}

// ***** MODIFIED: tokenize now accepts verificationDetails *****
async function tokenize(paymentMethod, verificationDetails) {
  if (!paymentMethod) {
    console.error("Card payment method (Square SDK card object) is not available for tokenization.");
    throw new Error("Card payment method not initialized.");
  }
  console.log("Calling card.tokenize() with verificationDetails:", JSON.stringify(verificationDetails, null, 2));
  const tokenResult = await paymentMethod.tokenize(verificationDetails); // Pass verificationDetails here

  if (tokenResult.status === "OK") {
    if (!tokenResult.token) {
        console.error("Tokenization OK but token is empty/falsy:", tokenResult);
        throw new Error("Tokenization succeeded but no token was returned.");
    }
    console.log("Tokenization successful, token:", tokenResult.token);
    return tokenResult.token;
  }

  // Handle errors
  let errorMessage = `Tokenization failed: ${tokenResult.status}`;
  if (tokenResult.errors) {
    errorMessage += ` ${JSON.stringify(tokenResult.errors)}`;
    tokenResult.errors.forEach(error => {
      console.error("Tokenization error detail:", error); // Log each error
      if (error.field) errorMessage += ` (Field: ${error.field})`;
      if (error.message) errorMessage += ` (Message: ${error.message})`;

      // Example of more specific error handling
      if (error.field === "cardNumber" && error.type === "INVALID") { // Square often uses 'type' for error codes in tokenResult.errors
          errorMessage = "Invalid card number. Please check and try again.";
      }
    });
  }
  throw new Error(errorMessage);
}

// ***** REMOVED: verifyBuyer function is no longer needed *****
// async function verifyBuyer(...) { ... }

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
    event.preventDefault();
    if (ipfsLinkContainer) {
      ipfsLinkContainer.innerHTML = '';
      ipfsLinkContainer.className = 'mt-6 p-4 border rounded-md text-sm bg-gray-50 shadow';
      ipfsLinkContainer.style.visibility = 'hidden';
    }
    showPaymentStatus('Processing payment...', 'info');

    if (currentOrderAmountCents <= 0) {
      showPaymentStatus('Invalid order amount. Please check sticker quantity/material.', 'error'); return;
    }

    try {
      const billingContact = {
        givenName: document.getElementById('firstName').value || undefined,
        familyName: document.getElementById('lastName').value || undefined,
        email: document.getElementById('email').value || undefined,
        phone: document.getElementById('phone').value || undefined, // Ensure E.164 or just digits for some regions
        addressLines: [document.getElementById('address').value || '123 Main St'],
        city: document.getElementById('city').value || undefined,
        state: document.getElementById('state').value || 'CA', // Use actual state if applicable
        postalCode: document.getElementById('postalCode').value || '90210',
        countryCode: "US", // Or determine dynamically
      };
      if (!billingContact.givenName || !billingContact.familyName || !billingContact.email || !billingContact.addressLines[0] || !billingContact.city || !billingContact.state || !billingContact.postalCode) {
          throw new Error("Please fill in all required billing details.");
      }
      if (!card) { throw new Error("Card payment method not initialized. Please refresh the page."); }
      // payments object is checked in BootStrap

      // ***** NEW: Construct verificationDetails for card.tokenize() *****
      const verificationDetails = {
        amount: String(currentOrderAmountCents),
        billingContact: billingContact,
        currencyCode: "USD",
        intent: "CHARGE", // As per new Square docs, 'intent' is used here, not 'intentType'
        customerInitiated: true, // Typically true for online payments
        sellerKeyedIn: false     // Typically false for online payments
      };
      console.log("Constructed verificationDetails for tokenize:", JSON.stringify(verificationDetails, null, 2));

      showPaymentStatus('Tokenizing card and verifying buyer...', 'info'); // Combined step
      const cardNonce = await tokenize(card, verificationDetails); // Pass verificationDetails here

      // No separate verifyBuyer call needed. cardNonce is the result of tokenization + internal verification.

      showPaymentStatus('Card tokenized. Creating payment...', 'info');
      const orderDetails = {
          quantity: stickerQuantityInput ? parseInt(stickerQuantityInput.value, 10) : 0,
          material: stickerMaterialSelect ? stickerMaterialSelect.value : 'unknown',
          cutLineFileName: document.getElementById('cutLineFile') && document.getElementById('cutLineFile').files.length > 0 ? document.getElementById('cutLineFile').files[0].name : null,
      };
      // ***** MODIFIED: Call createPayment without verificationToken *****
      const paymentResult = await createPayment(cardNonce, String(currentOrderAmountCents), "USD", orderDetails);

      if (paymentResult && (paymentResult.payment || (paymentResult.data && paymentResult.data.payment))) {
        const actualPayment = paymentResult.payment || paymentResult.data.payment;
        showPaymentStatus(`Payment successful! Status: ${actualPayment.status || 'COMPLETED'}. Payment ID: ${actualPayment.id.substring(0,15)}...`, 'success');
        if (ipfsLinkContainer) ipfsLinkContainer.style.visibility = 'visible';

        let canvasHasContent = false;
        try { canvasHasContent = ctx.getImageData(0, 0, 1, 1).data[3] > 0; }
        catch (e) { console.warn("Could not verify canvas content via getImageData:", e.message); canvasHasContent = !!originalImage; }

        if (canvasHasContent) {
          if(ipfsLinkContainer) ipfsLinkContainer.innerHTML = 'Processing image for IPFS upload...';
          canvas.toBlob(async (blob) => {
            if (blob) {
              try {
                if(ipfsLinkContainer) ipfsLinkContainer.innerHTML = 'Uploading to IPFS...';
                const ipfsFormData = new FormData();
                const fileName = `sticker_design_${Date.now()}.png`;
                ipfsFormData.append('file', blob, fileName);
                const response = await fetch('https://ipfs.infura.io:5001/api/v0/add', { method: 'POST', body: ipfsFormData });
                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
                }
                const result = await response.json(); const hash = result.Hash; console.log('IPFS Hash:', hash);
                if(ipfsLinkContainer) ipfsLinkContainer.innerHTML = `Successfully uploaded to IPFS! <br>Sticker Design Hash: ${hash} <br>View: <a href="https://ipfs.io/ipfs/${hash}" target="_blank" class="text-indigo-600 hover:text-indigo-800 underline">https://ipfs.io/ipfs/${hash}</a>`;
              } catch (ipfsError) {
                console.error('Error uploading to IPFS:', ipfsError);
                if(ipfsLinkContainer) ipfsLinkContainer.textContent = `Error uploading to IPFS: ${ipfsError.message}`;
              }
            } else {
              console.error('Failed to get blob from canvas for IPFS upload.');
              if(ipfsLinkContainer) ipfsLinkContainer.textContent = 'Could not prepare image for upload (failed to get blob).';
            }
          }, 'image/png');
        } else {
          if(ipfsLinkContainer) ipfsLinkContainer.textContent = 'No image to upload to IPFS or canvas is blank.';
        }
      } else {
        console.error("Payment creation failed or unexpected response:", paymentResult);
        const detail = paymentResult && paymentResult.errors && paymentResult.errors[0] ? paymentResult.errors[0].detail : (paymentResult ? JSON.stringify(paymentResult) : "Unknown error from payment processing server.");
        showPaymentStatus(`Payment failed: ${detail}`, 'error');
      }
    } catch (error) {
      console.error("Payment processing error in submit handler:", error);
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
        if (designMarginNote) designMarginNote.style.display = 'none';
        return;
    }
    const file = files[0];
    if (file && file.type.startsWith('image/')) {
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
                if (designMarginNote) designMarginNote.style.display = 'none';
            };
            img.src = reader.result;
        };
        reader.onerror = () => {
            showPaymentStatus('Error reading file.', 'error');
            originalImage = null; updateEditingButtonsState(true);
            if(ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
            if(fileInputGlobalRef) fileInputGlobalRef.value = '';
            if (designMarginNote) designMarginNote.style.display = 'none';
        };
        reader.readAsDataURL(file);
    } else {
        showPaymentStatus('Invalid file type. Please select an image file.', 'error');
        originalImage = null; updateEditingButtonsState(true);
        if(ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        if(fileInputGlobalRef) fileInputGlobalRef.value = '';
        if (designMarginNote) designMarginNote.style.display = 'none';
    }
}

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
