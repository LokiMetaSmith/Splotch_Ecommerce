// index.js

const appId = "sandbox-sq0idb-nbW_Oje9Dm0L5YvQ7WP2ow"; // Updated appId
const locationId = "LTS82DEX24XR0"; // Unchanged

let payments, card;
let originalImage = null; // To store the original loaded image
const canvas = document.getElementById('imageCanvas');
const ctx = canvas.getContext('2d');
let currentOrderAmountCents = 0; // ***** NEW: To store calculated order amount *****

// ***** NEW: HTML Elements for Sticker Order (Assumed to be in your HTML) *****
// const stickerQuantityInput = document.getElementById('stickerQuantity');
// const calculatedPriceDisplay = document.getElementById('calculatedPriceDisplay');

async function BootStrap() {
    try {
        payments = window.Square.payments(appId, locationId);
      } catch (error) {
        const statusContainer = document.getElementById("payment-status-container");
        statusContainer.className = "error text-red"; // Ensure splotch-theme styles apply if needed
        statusContainer.style.visibility = "visible";
        statusContainer.textContent = "Failed to load Square SDK " + error.message;
        return
      }
      try {
        card = await initializeCard(payments);
      } catch (e) {
        console.error("Initializing Card failed", e);
        showPaymentStatus(`Error initializing card form: ${e.message}`, 'error');
      }

      // ***** NEW: Initialize price calculation and add event listener for quantity changes *****
      const stickerQuantityInput = document.getElementById('stickerQuantity');
      if (stickerQuantityInput) {
          calculateAndUpdatePrice(); // Initial calculation
          stickerQuantityInput.addEventListener('input', calculateAndUpdatePrice);
          stickerQuantityInput.addEventListener('change', calculateAndUpdatePrice); // For up/down arrows
      } else {
          console.warn("Sticker quantity input with ID 'stickerQuantity' not found. Dynamic pricing will not work.");
          // Fallback to a default amount if dynamic pricing elements are missing
          currentOrderAmountCents = 100; // Default to 100 cents ($1.00)
          const priceDisplay = document.getElementById('calculatedPriceDisplay');
          if (priceDisplay) {
            priceDisplay.textContent = formatPrice(currentOrderAmountCents);
          }
      }
}
BootStrap()

// ***** NEW: Function to calculate sticker price *****
function calculateStickerPrice(quantity) {
    if (quantity <= 0) return 0;
    let pricePerStickerCents;

    // Example pricing tiers (adjust to your needs)
    if (quantity < 100) {
        pricePerStickerCents = 80; // 80 cents each
    } else if (quantity < 250) {
        pricePerStickerCents = 60; // 60 cents each
    } else {
        pricePerStickerCents = 40; // 40 cents each
    }
    return quantity * pricePerStickerCents;
}

// ***** NEW: Function to update price display and global amount variable *****
function calculateAndUpdatePrice() {
    const stickerQuantityInput = document.getElementById('stickerQuantity');
    const calculatedPriceDisplay = document.getElementById('calculatedPriceDisplay');

    if (stickerQuantityInput && calculatedPriceDisplay) {
        const quantity = parseInt(stickerQuantityInput.value, 10);
        if (isNaN(quantity) || quantity < 0) {
            currentOrderAmountCents = 0;
            calculatedPriceDisplay.textContent = "Invalid Quantity";
            return;
        }
        currentOrderAmountCents = calculateStickerPrice(quantity);
        calculatedPriceDisplay.textContent = formatPrice(currentOrderAmountCents);
    } else {
        // Fallback if elements are not found after bootstrap
        currentOrderAmountCents = 100; // Default if dynamic elements are missing
        if (document.getElementById('calculatedPriceDisplay')) {
             document.getElementById('calculatedPriceDisplay').textContent = formatPrice(currentOrderAmountCents);
        }
    }
}

// ***** NEW: Helper to format price for display *****
function formatPrice(amountInCents) {
    const amountInDollars = amountInCents / 100;
    return amountInDollars.toLocaleString("en-US", {style:"currency", currency:"USD"});
}


async function initializeCard(payments) {
  const card = await payments.card();
  await card.attach("#card-container");
  return card;
}

async function createPayment(token, verificationToken, amount, currency) { // ***** MODIFIED: Added amount and currency *****
  const body = JSON.stringify({
    locationId,
    sourceId: token,
    verificationToken,
    idempotencyKey: window.crypto.randomUUID(),
    amount: amount, // ***** NEW: Pass calculated amount to backend *****
    currency: currency, // ***** NEW: Pass currency to backend *****
  });

  const paymentResponse = await fetch("/payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (paymentResponse.ok) {
    return paymentResponse.json();
  }

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
  if (tokenResult.status === "OK") {
    return tokenResult.token;
  } else {
    let errorMessage = `Tokenization failed with status: ${tokenResult.status}`;
    if (tokenResult.errors) {
      errorMessage += ` and errors: ${JSON.stringify(tokenResult.errors)}`;
      tokenResult.errors.forEach(error => {
        if (error.field === "cardNumber" && error.code === "INVALID") {
            errorMessage = "Invalid card number. Please check and try again.";
        }
      });
    }
    throw new Error(errorMessage);
  }
}

async function verifyBuyer(payments, token, billingContact, amountCents) { // ***** MODIFIED: Added amountCents *****
  const verificationDetails = {
    amount: String(amountCents), // ***** MODIFIED: Use dynamic amount *****
    billingContact: billingContact,
    currencyCode: "USD",
    intentType: "CHARGE",
  };

  console.log("Sending to payments.verifyBuyer:", JSON.stringify(verificationDetails, null, 2));
  const verificationResults = await payments.verifyBuyer(
    token,
    verificationDetails
  );
  return verificationResults.token;
}

var form = document.getElementById('payment-form');

form.addEventListener('submit', async function(event) {
  event.preventDefault();

  const paymentStatusContainer = document.getElementById('payment-status-container');
  const ipfsLinkContainer = document.getElementById('ipfsLinkContainer');
  const baseIpfsClasses = 'mt-6 p-4 border rounded-md text-sm bg-gray-50 shadow';

  if (ipfsLinkContainer) {
    ipfsLinkContainer.innerHTML = '';
    ipfsLinkContainer.className = baseIpfsClasses;
  }
  showPaymentStatus('Processing payment...', 'info');

  if (currentOrderAmountCents <= 0) { // ***** NEW: Check for valid amount before proceeding *****
    showPaymentStatus('Invalid order amount. Please check sticker quantity.', 'error');
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
        throw new Error("Please fill in all required billing details: First Name, Last Name, Email, Address, City, State, and Postal Code.");
    }
    if (!card) {
        throw new Error("Card payment method not initialized. Please refresh the page.");
    }

    showPaymentStatus('Tokenizing card...', 'info');
    const token = await tokenize(card);

    showPaymentStatus('Card tokenized. Verifying buyer...', 'info');
    console.log("Billing Contact being sent to verifyBuyer (from submit handler):", JSON.stringify(billingContact, null, 2));
    // ***** MODIFIED: Pass currentOrderAmountCents to verifyBuyer *****
    const verificationToken = await verifyBuyer(payments, token, billingContact, currentOrderAmountCents);

    showPaymentStatus('Buyer verified. Creating payment...', 'info');
    // ***** MODIFIED: Pass currentOrderAmountCents and currency to createPayment (which sends it to backend) *****
    const paymentResult = await createPayment(token, verificationToken, String(currentOrderAmountCents), "USD");

    if (paymentResult && (paymentResult.payment || (paymentResult.data && paymentResult.data.payment))) {
      const actualPayment = paymentResult.payment || paymentResult.data.payment;
      showPaymentStatus(`Payment successful! Status: ${actualPayment.status || 'COMPLETED'}. Payment ID: ${actualPayment.id.substring(0,15)}...`, 'success');

      let canvasHasContent = false;
      try {
        canvasHasContent = ctx.getImageData(0, 0, 1, 1).data[3] > 0;
      } catch (e) {
        console.warn("Could not verify canvas content via getImageData:", e.message);
        canvasHasContent = !!originalImage;
      }

      if (originalImage && canvasHasContent) {
        if(ipfsLinkContainer) {
            ipfsLinkContainer.className = `${baseIpfsClasses} text-blue-700`;
            ipfsLinkContainer.innerHTML = 'Processing image for IPFS upload...';
        }
        canvas.toBlob(async (blob) => {
          if (blob) {
            try {
              if(ipfsLinkContainer) {
                ipfsLinkContainer.className = `${baseIpfsClasses} text-blue-700`;
                ipfsLinkContainer.innerHTML = 'Uploading to IPFS...';
              }
              const ipfsFormData = new FormData();
              const fileName = `edited_image_${Date.now()}.png`;
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
                ipfsLinkContainer.innerHTML = `Successfully uploaded to IPFS! <br>Hash: ${hash} <br>View: <a href="https://ipfs.io/ipfs/${hash}" target="_blank" class="text-indigo-600 hover:text-indigo-800 underline">https://ipfs.io/ipfs/${hash}</a>`;
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

const fileInput = document.getElementById('file');

const editingButtons = [
    document.getElementById('rotateLeftBtn'),
    document.getElementById('rotateRightBtn'),
    document.getElementById('resizeBtn'),
    document.getElementById('startCropBtn'),
    document.getElementById('grayscaleBtn'),
    document.getElementById('sepiaBtn')
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
}
updateEditingButtonsState(true);

function showPaymentStatus(message, type = 'info') {
    const container = document.getElementById('payment-status-container');
    container.textContent = message;
    container.style.visibility = 'visible';
    container.classList.remove('payment-success', 'payment-error', 'payment-info');
    if (type === 'success') { container.classList.add('payment-success'); }
    else if (type === 'error') { container.classList.add('payment-error'); }
    else { container.classList.add('payment-info'); }
}

fileInput.addEventListener('change', (event) => {
    const files = event.target.files;
    if (files.length === 0) {
        showPaymentStatus('No file selected. Please choose an image file.', 'error');
        originalImage = null;
        updateEditingButtonsState(true);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        fileInput.value = '';
        return;
    }
    const file = files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                originalImage = img;
                updateEditingButtonsState(false);
                const paymentStatusContainer = document.getElementById('payment-status-container');
                if (paymentStatusContainer.textContent.includes('Please select an image file') || paymentStatusContainer.textContent.includes('No file selected') || paymentStatusContainer.textContent.includes('Invalid file type')) {
                   showPaymentStatus('Image loaded successfully.', 'success');
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const hRatio = canvas.width / img.width;
                const vRatio = canvas.height / img.height;
                const ratio = Math.min(hRatio, vRatio);
                const centerShift_x = (canvas.width - img.width * ratio) / 2;
                const centerShift_y = (canvas.height - img.height * ratio) / 2;
                ctx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height,
                              centerShift_x, centerShift_y, originalImage.width * ratio, originalImage.height * ratio);
            };
            img.onerror = () => {
                showPaymentStatus('Error loading image data. The file may be corrupt or not a valid image.', 'error');
                originalImage = null; updateEditingButtonsState(true); ctx.clearRect(0, 0, canvas.width, canvas.height); fileInput.value = '';
            };
            img.src = reader.result;
        };
        reader.onerror = () => {
            showPaymentStatus('Error reading file. Please try again.', 'error');
            originalImage = null; updateEditingButtonsState(true); ctx.clearRect(0, 0, canvas.width, canvas.height); fileInput.value = '';
        };
        reader.readAsDataURL(file);
    } else {
        showPaymentStatus('Invalid file type. Please select an image file (e.g., PNG, JPG).', 'error');
        originalImage = null; updateEditingButtonsState(true); ctx.clearRect(0, 0, canvas.width, canvas.height); fileInput.value = '';
    }
});

function redrawOriginalImage() {
    if (!originalImage) { showPaymentStatus('No image loaded to redraw.', 'error'); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hRatio = canvas.width / originalImage.width; const vRatio = canvas.height / originalImage.height;
    const ratio = Math.min(hRatio, vRatio);
    const centerShift_x = (canvas.width - originalImage.width * ratio) / 2;
    const centerShift_y = (canvas.height - originalImage.height * ratio) / 2;
    ctx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height, centerShift_x, centerShift_y, originalImage.width * ratio, originalImage.height * ratio);
}

function rotateCanvasContentFixedBounds(angleDegrees) {
    if (!originalImage) { showPaymentStatus('Please load an image first before trying to rotate.', 'error'); return; }
    try {
        if (ctx.getImageData(0,0,1,1).data[3] === 0 && originalImage) { redrawOriginalImage(); }
    } catch (e) { console.warn("Could not verify canvas content for rotation via getImageData:", e.message); }
    if (!canvas.width || !canvas.height ) { showPaymentStatus("Canvas not properly initialized for rotation.", 'error'); return; }
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
        tempCtx.drawImage(imgToRotate, -w / 2, -h / 2);
        canvas.width = newCanvasWidth; canvas.height = newCanvasHeight;
        ctx.clearRect(0,0,canvas.width, canvas.height); ctx.drawImage(tempCanvas, 0,0);
    };
    imgToRotate.onerror = () => { showPaymentStatus('Error loading temporary image for rotation.', 'error'); };
    imgToRotate.src = currentDataUrl;
}

document.getElementById('rotateLeftBtn').addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
document.getElementById('rotateRightBtn').addEventListener('click', () => rotateCanvasContentFixedBounds(90));

document.getElementById('grayscaleBtn').addEventListener('click', () => {
    if (!originalImage) { showPaymentStatus("Please load an image first to apply grayscale.", 'error'); return; }
    try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
        }
        ctx.putImageData(imageData, 0, 0);
    } catch (e) { showPaymentStatus(`Error applying grayscale: ${e.message}. Canvas may be tainted.`, 'error'); }
});

document.getElementById('sepiaBtn').addEventListener('click', () => {
    if (!originalImage) { showPaymentStatus("Please load an image first to apply sepia.", 'error'); return; }
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

document.getElementById('resizeBtn').addEventListener('click', () => {
    if (!originalImage) { showPaymentStatus("Please load an image first before resizing.", 'error'); return; }
    let currentCanvasDataUrl;
    try { currentCanvasDataUrl = canvas.toDataURL(); }
    catch (e) { showPaymentStatus(`Cannot resize: ${e.message}. Canvas may be tainted. Try reloading the original image.`, 'error'); return; }
    const imgToResize = new Image();
    imgToResize.onload = () => {
        const percentageText = resizeInput.value;
        if (!percentageText.endsWith('%')) { showPaymentStatus("Resize input must be a percentage (e.g., '50%').", 'error'); return; }
        const percentage = parseFloat(percentageText.replace('%', ''));
        if (isNaN(percentage) || percentage <= 0) { showPaymentStatus("Please enter a valid positive percentage for resize.", 'error'); return; }
        const newWidth = imgToResize.width * (percentage / 100); const newHeight = imgToResize.height * (percentage / 100);
        if (newWidth <= 0 || newHeight <= 0 || newWidth > 10000 || newHeight > 10000) { showPaymentStatus("Calculated resize dimensions are invalid or too large.", 'error'); return; }
        canvas.width = newWidth; canvas.height = newHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(imgToResize, 0, 0, newWidth, newHeight);
        resizeInput.value = ''; showPaymentStatus(`Image resized to ${percentage}%.`, 'success');
    };
    imgToResize.onerror = () => showPaymentStatus('Error preparing image for resize.', 'error');
    imgToResize.src = currentCanvasDataUrl;
});

document.getElementById('startCropBtn').addEventListener('click', () => {
    if (!canvas.width || !canvas.height || (ctx.getImageData(0,0,1,1).data[3] === 0 && !originalImage)) { showPaymentStatus("Please load an image or ensure canvas has content before cropping.", 'error'); return; }
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

