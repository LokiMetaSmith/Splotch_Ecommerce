// index.js

const appId = "sandbox-sq0idb-nbW_Oje9Dm0L5YvQ7WP2ow";
const locationId = "LTS82DEX24XR0";

let payments, card;
let originalImage = null;
const canvas = document.getElementById('imageCanvas');
const ctx = canvas.getContext('2d');
let currentOrderAmountCents = 0;

const textInput = document.getElementById('textInput');
const textSizeInput = document.getElementById('textSizeInput');
const textColorInput = document.getElementById('textColorInput');
const addTextBtn = document.getElementById('addTextBtn');
const textFontFamilySelect = document.getElementById('textFontFamily');

const stickerMaterialSelect = document.getElementById('stickerMaterial');
const designMarginNote = document.getElementById('designMarginNote');


async function BootStrap() {
    console.log(`Initializing Square SDK with appId: ${appId}, locationId: ${locationId}`); // Added console.log from your version
    try {
        payments = window.Square.payments(appId, locationId);
      } catch (error) {
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

      const stickerQuantityInput = document.getElementById('stickerQuantity');
      if (stickerQuantityInput) {
          calculateAndUpdatePrice();
          stickerQuantityInput.addEventListener('input', calculateAndUpdatePrice);
          stickerQuantityInput.addEventListener('change', calculateAndUpdatePrice);
      } else {
          console.warn("Sticker quantity input with ID 'stickerQuantity' not found.");
          currentOrderAmountCents = 100; // Default
          const priceDisplay = document.getElementById('calculatedPriceDisplay');
          if (priceDisplay) priceDisplay.textContent = formatPrice(currentOrderAmountCents);
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

    if (quantity < 50) {
        pricePerStickerCents = 80;
    } else if (quantity < 100) {
        pricePerStickerCents = 70;
    } else if (quantity < 250) {
        pricePerStickerCents = 60;
    } else if (quantity < 500) {
        pricePerStickerCents = 50;
    } else {
        pricePerStickerCents = 40;
    }

    let materialMultiplier = 1.0;
    if (material === 'pvc_laminated') {
        materialMultiplier = 1.5;
    }
    const totalBasePrice = quantity * pricePerStickerCents;
    return Math.round(totalBasePrice * materialMultiplier);
}

function calculateAndUpdatePrice() {
    const stickerQuantityInput = document.getElementById('stickerQuantity');
    const calculatedPriceDisplay = document.getElementById('calculatedPriceDisplay');
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
        if (document.getElementById('calculatedPriceDisplay')) {
             document.getElementById('calculatedPriceDisplay').textContent = formatPrice(currentOrderAmountCents);
        }
    }
}

function formatPrice(amountInCents) {
    const amountInDollars = amountInCents / 100;
    return amountInDollars.toLocaleString("en-US", {style:"currency", currency:"USD"});
}

async function initializeCard(payments) {
  const card = await payments.card();
  await card.attach("#card-container");
  return card;
}

async function createPayment(token, verificationToken, amount, currency, orderDetails) {
  const body = JSON.stringify({
    locationId,
    sourceId: token,
    verificationToken,
    idempotencyKey: window.crypto.randomUUID(),
    amount: amount,
    currency: currency,
    orderDetails: orderDetails
  });

  const paymentResponse = await fetch("/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (paymentResponse.ok) { return paymentResponse.json(); }
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

async function tokenize(paymentMethod) {
  const tokenResult = await paymentMethod.tokenize();
  if (tokenResult.status === "OK") { return tokenResult.token; }
  let errorMessage = `Tokenization failed: ${tokenResult.status}`;
  if (tokenResult.errors) {
    errorMessage += ` ${JSON.stringify(tokenResult.errors)}`;
    tokenResult.errors.forEach(error => {
      if (error.field === "cardNumber" && error.code === "INVALID") {
          errorMessage = "Invalid card number. Please check and try again.";
      }
    });
  }
  throw new Error(errorMessage);
}

async function verifyBuyer(payments, token, billingContact, amountCents) {
  const verificationDetails = {
    amount: String(amountCents),
    billingContact: billingContact,
    currencyCode: "USD",
    intentType: "CHARGE",
  };
  console.log("Sending to payments.verifyBuyer:", JSON.stringify(verificationDetails, null, 2));
  const verificationResults = await payments.verifyBuyer(token, verificationDetails);
  return verificationResults.token;
}

function handleAddText() {
    if (!originalImage && ctx.getImageData(0,0,1,1).data[3] === 0) {
        showPaymentStatus("Please load an image before adding text.", 'error');
        return;
    }
    if (!textInput || !textSizeInput || !textColorInput || !textFontFamilySelect) {
        console.error("Text input elements not found.");
        showPaymentStatus("Text input elements are missing. Cannot add text.", 'error');
        return;
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

var form = document.getElementById('payment-form');
if (form) {
    form.addEventListener('submit', async function(event) {
      event.preventDefault();
      const paymentStatusContainer = document.getElementById('payment-status-container');
      const ipfsLinkContainer = document.getElementById('ipfsLinkContainer');
      const baseIpfsClasses = 'mt-6 p-4 border rounded-md text-sm bg-gray-50 shadow';

      if (ipfsLinkContainer) {
        ipfsLinkContainer.innerHTML = '';
        ipfsLinkContainer.className = baseIpfsClasses;
        ipfsLinkContainer.style.visibility = 'hidden';
      }
      showPaymentStatus('Processing payment...', 'info');

      if (currentOrderAmountCents <= 0) {
        showPaymentStatus('Invalid order amount. Please check sticker quantity/material.', 'error');
        return;
      }

      try {
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

        showPaymentStatus('Tokenizing card...', 'info');
        const token = await tokenize(card);

        showPaymentStatus('Card tokenized. Verifying buyer...', 'info');
        const verificationToken = await verifyBuyer(payments, token, billingContact, currentOrderAmountCents);

        showPaymentStatus('Buyer verified. Creating payment...', 'info');

        const stickerQuantityInput = document.getElementById('stickerQuantity');
        const cutLineFileInput = document.getElementById('cutLineFile');
        const orderDetails = {
            quantity: stickerQuantityInput ? parseInt(stickerQuantityInput.value, 10) : 0,
            material: stickerMaterialSelect ? stickerMaterialSelect.value : 'unknown',
            cutLineFileName: cutLineFileInput && cutLineFileInput.files.length > 0 ? cutLineFileInput.files[0].name : null,
        };

        const paymentResult = await createPayment(token, verificationToken, String(currentOrderAmountCents), "USD", orderDetails);

        if (paymentResult && (paymentResult.payment || (paymentResult.data && paymentResult.data.payment))) {
          const actualPayment = paymentResult.payment || paymentResult.data.payment;
          showPaymentStatus(`Payment successful! Status: ${actualPayment.status || 'COMPLETED'}. Payment ID: ${actualPayment.id.substring(0,15)}...`, 'success');

          let canvasHasContent = false;
          try { canvasHasContent = ctx.getImageData(0, 0, 1, 1).data[3] > 0; }
          catch (e) { console.warn("Could not verify canvas content via getImageData:", e.message); canvasHasContent = !!originalImage; }

          if (canvasHasContent) {
            if(ipfsLinkContainer) {
                ipfsLinkContainer.className = `${baseIpfsClasses} text-blue-700`;
                ipfsLinkContainer.innerHTML = 'Processing image for IPFS upload...';
                ipfsLinkContainer.style.visibility = 'visible';
            }
            canvas.toBlob(async (blob) => {
              if (blob) {
                try {
                  if(ipfsLinkContainer) {
                    ipfsLinkContainer.className = `${baseIpfsClasses} text-blue-700`;
                    ipfsLinkContainer.innerHTML = 'Uploading to IPFS...';
                  }
                  const ipfsFormData = new FormData();
                  const fileName = `sticker_design_${Date.now()}.png`;
                  ipfsFormData.append('file', blob, fileName);

                  const response = await fetch('https://ipfs.infura.io:5001/api/v0/add', { method: 'POST', body: ipfsFormData });
                  if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
                  }
                  const result = await response.json();
                  const hash = result.Hash;
                  console.log('IPFS Hash:', hash);
                  if(ipfsLinkContainer) {
                    ipfsLinkContainer.className = `${baseIpfsClasses} text-green-700`;
                    ipfsLinkContainer.innerHTML = `Successfully uploaded to IPFS! <br>Sticker Design Hash: ${hash} <br>View: <a href="https://ipfs.io/ipfs/${hash}" target="_blank" class="text-indigo-600 hover:text-indigo-800 underline">https://ipfs.io/ipfs/${hash}</a>`;
                  }
                } catch (ipfsError) {
                  console.error('Error uploading to IPFS:', ipfsError);
                  if(ipfsLinkContainer) {
                    ipfsLinkContainer.className = `${baseIpfsClasses} text-red-700`;
                    ipfsLinkContainer.textContent = `Error uploading to IPFS: ${ipfsError.message}`;
                  }
                }
              } else {
                console.error('Failed to get blob from canvas for IPFS upload.');
                if(ipfsLinkContainer) {
                    ipfsLinkContainer.className = `${baseIpfsClasses} text-red-700`;
                    ipfsLinkContainer.textContent = 'Could not prepare image for upload (failed to get blob).';
                }
              }
            }, 'image/png');
          } else {
            if(ipfsLinkContainer) {
                ipfsLinkContainer.className = baseIpfsClasses;
                ipfsLinkContainer.textContent = 'No image to upload to IPFS or canvas is blank.';
                ipfsLinkContainer.style.visibility = 'visible';
            }
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
    });
} else {
    console.error("Payment form with ID 'payment-form' not found.");
}

const fileInput = document.getElementById('file');

const editingButtons = [
    document.getElementById('rotateLeftBtn'), document.getElementById('rotateRightBtn'),
    document.getElementById('resizeBtn'), document.getElementById('startCropBtn'),
    document.getElementById('grayscaleBtn'), document.getElementById('sepiaBtn'),
];
const resizeInput = document.getElementById('resizeInput');

function updateEditingButtonsState(disabled) {
    const disabledClasses = ['opacity-50', 'cursor-not-allowed'];
    editingButtons.forEach(button => {
        if (button) {
            button.disabled = disabled;
            if (disabled) { button.classList.add(...disabledClasses); }
            else { button.classList.remove(...disabledClasses); }
        }
    });
    if (resizeInput) {
        resizeInput.disabled = disabled;
        if (disabled) { resizeInput.classList.add(...disabledClasses); }
        else { resizeInput.classList.remove(...disabledClasses); }
    }
    const textControlsContainer = document.getElementById('text-editing-controls');
    if (textControlsContainer) {
        const textToolInputs = textControlsContainer.querySelectorAll('input, select, button');
        textToolInputs.forEach(input => {
            input.disabled = disabled;
             if (disabled) { input.classList.add(...disabledClasses); }
            else { input.classList.remove(...disabledClasses); }
        });
    }
    if (designMarginNote) {
        designMarginNote.style.display = disabled ? 'none' : 'block';
    }
}

function showPaymentStatus(message, type = 'info') {
    const container = document.getElementById('payment-status-container');
    if (!container) return;
    container.textContent = message;
    container.style.visibility = 'visible';
    container.classList.remove('payment-success', 'payment-error', 'payment-info');
    if (type === 'success') { container.classList.add('payment-success'); }
    else if (type === 'error') { container.classList.add('payment-error'); }
    else { container.classList.add('payment-info'); }
}

if (fileInput) {
    fileInput.addEventListener('change', (event) => {
        const files = event.target.files;
        if (files.length === 0) {
            showPaymentStatus('No file selected. Please choose an image file.', 'error');
            originalImage = null; updateEditingButtonsState(true);
            ctx.clearRect(0, 0, canvas.width, canvas.height); fileInput.value = '';
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
                    const paymentStatusContainer = document.getElementById('payment-status-container');
                    if (paymentStatusContainer && (paymentStatusContainer.textContent.includes('Please select an image file') || paymentStatusContainer.textContent.includes('No file selected') || paymentStatusContainer.textContent.includes('Invalid file type'))) {
                       showPaymentStatus('Image loaded successfully.', 'success');
                    }
                    const maxWidth = 500; const maxHeight = 400;
                    let newWidth = img.width; let newHeight = img.height;
                    if (newWidth > maxWidth) { const r = maxWidth / newWidth; newWidth = maxWidth; newHeight *= r; }
                    if (newHeight > maxHeight) { const r = maxHeight / newHeight; newHeight = maxHeight; newWidth *= r; }
                    canvas.width = newWidth; canvas.height = newHeight;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
                    if (designMarginNote) designMarginNote.style.display = 'block';
                };
                img.onerror = () => {
                    showPaymentStatus('Error loading image data.', 'error');
                    originalImage = null; updateEditingButtonsState(true); ctx.clearRect(0, 0, canvas.width, canvas.height); fileInput.value = '';
                    if (designMarginNote) designMarginNote.style.display = 'none';
                };
                img.src = reader.result;
            };
            reader.onerror = () => {
                showPaymentStatus('Error reading file.', 'error');
                originalImage = null; updateEditingButtonsState(true); ctx.clearRect(0, 0, canvas.width, canvas.height); fileInput.value = '';
                if (designMarginNote) designMarginNote.style.display = 'none';
            };
            reader.readAsDataURL(file);
        } else {
            showPaymentStatus('Invalid file type. Please select an image file.', 'error');
            originalImage = null; updateEditingButtonsState(true); ctx.clearRect(0, 0, canvas.width, canvas.height); fileInput.value = '';
            if (designMarginNote) designMarginNote.style.display = 'none';
        }
    });
} else {
    console.warn("File input with ID 'file' not found.");
}

function redrawOriginalImage() {
    if (!originalImage) { showPaymentStatus('No image loaded to redraw.', 'error'); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hRatio = canvas.width / originalImage.width; const vRatio = canvas.height / originalImage.height;
    const ratio = Math.min(hRatio, vRatio);
    const centerShift_x = (canvas.width - originalImage.width * ratio) / 2;
    const centerShift_y = (canvas.height - originalImage.height * ratio) / 2;
    ctx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height, centerShift_x, centerShift_y, originalImage.width * ratio, originalImage.height * ratio);
    showPaymentStatus('Image reset to original.', 'info');
}

function rotateCanvasContentFixedBounds(angleDegrees) {
    if (!canvas.width || !canvas.height || (ctx.getImageData(0,0,1,1).data[3] === 0 && !originalImage)) {
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

const rotateLeftBtn = document.getElementById('rotateLeftBtn');
if (rotateLeftBtn) rotateLeftBtn.addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
const rotateRightBtn = document.getElementById('rotateRightBtn');
if (rotateRightBtn) rotateRightBtn.addEventListener('click', () => rotateCanvasContentFixedBounds(90));

const grayscaleBtn = document.getElementById('grayscaleBtn');
if (grayscaleBtn) {
    grayscaleBtn.addEventListener('click', () => {
        if (!canvas.width || !canvas.height || (ctx.getImageData(0,0,1,1).data[3] === 0 && !originalImage)) { showPaymentStatus("Please load an image first to apply grayscale.", 'error'); return; }
        try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
            }
            ctx.putImageData(imageData, 0, 0);
        } catch (e) { showPaymentStatus(`Error applying grayscale: ${e.message}. Canvas may be tainted.`, 'error'); }
    });
}

const sepiaBtn = document.getElementById('sepiaBtn');
if (sepiaBtn) {
    sepiaBtn.addEventListener('click', () => {
        if (!canvas.width || !canvas.height || (ctx.getImageData(0,0,1,1).data[3] === 0 && !originalImage)) { showPaymentStatus("Please load an image first to apply sepia.", 'error'); return; }
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
    });
}

const resizeBtn = document.getElementById('resizeBtn');
if (resizeBtn) {
    resizeBtn.addEventListener('click', () => {
        if (!canvas.width || !canvas.height || (ctx.getImageData(0,0,1,1).data[3] === 0 && !originalImage)) {
            showPaymentStatus("Please load an image first before resizing.", 'error'); return;
        }
        let currentCanvasDataUrl;
        try { currentCanvasDataUrl = canvas.toDataURL(); }
        catch (e) { showPaymentStatus(`Cannot resize: ${e.message}. Canvas may be tainted. Try reloading the original image.`, 'error'); return; }
        const imgToResize = new Image();
        imgToResize.onload = () => {
            const resizeInputElement = document.getElementById('resizeInput');
            if (!resizeInputElement) { console.error("Resize input not found"); return; }
            const percentageText = resizeInputElement.value;
            if (!percentageText.endsWith('%')) { showPaymentStatus("Resize input must be a percentage (e.g., '50%').", 'error'); return; }
            const percentage = parseFloat(percentageText.replace('%', ''));
            if (isNaN(percentage) || percentage <= 0) { showPaymentStatus("Please enter a valid positive percentage for resize.", 'error'); return; }
            const newWidth = imgToResize.width * (percentage / 100); const newHeight = imgToResize.height * (percentage / 100);
            if (newWidth <= 0 || newHeight <= 0 || newWidth > 10000 || newHeight > 10000) { showPaymentStatus("Calculated resize dimensions are invalid or too large.", 'error'); return; }
            canvas.width = newWidth; canvas.height = newHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(imgToResize, 0, 0, newWidth, newHeight);
            if(resizeInputElement) resizeInputElement.value = '';
            showPaymentStatus(`Image resized to ${percentage}%.`, 'success');
        };
        imgToResize.onerror = () => showPaymentStatus('Error preparing image for resize.', 'error');
        imgToResize.src = currentCanvasDataUrl;
    });
}

const startCropBtn = document.getElementById('startCropBtn');
if (startCropBtn) {
    startCropBtn.addEventListener('click', () => {
        if (!canvas.width || !canvas.height || (ctx.getImageData(0,0,1,1).data[3] === 0 && !originalImage)) {
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
    });
}
