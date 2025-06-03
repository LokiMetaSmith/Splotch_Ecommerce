const appId = "sandbox-sq0idb-nbW_Oje9Dm0L5YvQ7WP2ow"; // Updated appId
const locationId = "LTS82DEX24XR0"; // Unchanged

let payments, card;

async function BootStrap() {
    try {
        payments = window.Square.payments(appId, locationId);
      } catch (error) {
        const statusContainer = document.getElementById("payment-status-container");
        statusContainer.className = "error text-red";
        statusContainer.style.visibility = "visible";
        statusContainer.textContent = "Failed to load Square SDK " + error.message;
        return
      }
      try {
        card = await initializeCard(payments);
      } catch (e) {
        console.error("Initializing Card failed", e);
      }

}
BootStrap()

async function initializeCard(payments) {
  const card = await payments.card();
  await card.attach("#card-container");

  return card;
}

async function createPayment(token, verificationToken) {
  const body = JSON.stringify({
    locationId,
    sourceId: token,
    verificationToken,
    idempotencyKey: window.crypto.randomUUID(),
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

  const errorBody = await paymentResponse.text();
  throw new Error(errorBody);
}

async function tokenize(paymentMethod) {
  const tokenResult = await paymentMethod.tokenize();
  if (tokenResult.status === "OK") {
    return tokenResult.token;
  } else {
    let errorMessage = `Tokenization failed with status: ${tokenResult.status}`;
    if (tokenResult.errors) {
      errorMessage += ` and errors: ${JSON.stringify(tokenResult.errors)}`;
    }

    throw new Error(errorMessage);
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
var form = document.getElementById('payment-form');

// Attach the submit event handler
form.addEventListener('submit', async function(event) { // Made async
  event.preventDefault(); // Prevent default form submission

  const paymentStatusContainer = document.getElementById('payment-status-container');
  const ipfsLinkContainer = document.getElementById('ipfsLinkContainer');

  // Reset classes and apply base style, then specific status style
  const baseStatusClasses = 'mb-4 p-3 rounded-md text-sm text-white';
  const baseIpfsClasses = 'mt-6 p-4 border rounded-md text-sm bg-gray-50 shadow';


  // Initial UI Update
  if (ipfsLinkContainer) {
    ipfsLinkContainer.innerHTML = '';
    ipfsLinkContainer.className = baseIpfsClasses; // Reset to base
  }
  paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`;
  paymentStatusContainer.textContent = 'Processing payment...';
  paymentStatusContainer.style.visibility = 'visible';


  try {
    // Billing Contact from form fields
    const billingContact = {
      givenName: document.getElementById('firstName').value || undefined,
      familyName: document.getElementById('lastName').value || undefined,
      email: document.getElementById('email').value || undefined,
      phone: document.getElementById('phone').value || undefined,
      addressLines: [document.getElementById('address').value || '123 Main St'], // Default if empty
      city: document.getElementById('city').value || undefined,
      state: document.getElementById('state').value || 'CA', // Default if empty
      postalCode: document.getElementById('postalCode').value || '90210', // Added postalCode
      countryCode: "US", // Hardcoded as per requirement
    };

    // Check for required billing contact fields for Square
    // Added postalCode to the check.
    if (!billingContact.givenName || !billingContact.familyName || !billingContact.email || !billingContact.addressLines[0] || !billingContact.city || !billingContact.state || !billingContact.postalCode) {
        throw new Error("Please fill in all required billing details: First Name, Last Name, Email, Address, City, State, and Postal Code.");
    }

    paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`;
    paymentStatusContainer.textContent = 'Tokenizing card...';
    const token = await tokenize(card); // Assuming 'card' is globally available and initialized

    paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`;
    paymentStatusContainer.textContent = 'Card tokenized. Verifying buyer...';
    console.log("Billing Contact being sent to verifyBuyer:", JSON.stringify(billingContact, null, 2)); // Added console.log
    const verificationToken = await verifyBuyer(payments, token, billingContact); // Assuming 'payments' is globally available

    paymentStatusContainer.className = `${baseStatusClasses} bg-blue-500`;
    paymentStatusContainer.textContent = 'Buyer verified. Creating payment (mocked)...';
    // Mock createPayment call
    console.log("Simulating createPayment with token:", token, "and verificationToken:", verificationToken);
    const mockPaymentResult = { success: true, message: "Payment processed successfully (mocked)." }; // Mocked result

    if (mockPaymentResult.success) {
      paymentStatusContainer.className = `${baseStatusClasses} bg-green-500`;
      paymentStatusContainer.textContent = mockPaymentResult.message;

      // --- IPFS UPLOAD LOGIC (Nested) ---
      // canvas and ctx are assumed to be globally available
      let canvasHasContent = false;
      try {
        canvasHasContent = ctx.getImageData(0, 0, 1, 1).data[3] > 0;
      } catch (e) {
        // This can happen if canvas is blank or too small, or context is lost.
        console.warn("Could not verify canvas content via getImageData:", e.message);
        canvasHasContent = !!originalImage; // Fallback to checking if originalImage was ever loaded
      }


      if (originalImage && canvasHasContent) { // Check if an original image was loaded and canvas likely has content
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

              const response = await fetch('https://ipfs.infura.io:5001/api/v0/add', {
                method: 'POST',
                body: ipfsFormData,
              });

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
            ipfsLinkContainer.className = baseIpfsClasses; // Reset to base, text will be default
            ipfsLinkContainer.textContent = 'No image to upload to IPFS or canvas is blank.';
        }
      }
    } else {
      // Mock payment failed
      paymentStatusContainer.className = `${baseStatusClasses} bg-red-500`;
      paymentStatusContainer.textContent = mockPaymentResult.message || "Payment processing failed (mocked).";
    }

  } catch (error) {
    // Catch errors from tokenization, verification, or other parts of the try block
    console.error("Payment processing error:", error);
    paymentStatusContainer.className = `${baseStatusClasses} bg-red-500`;
    paymentStatusContainer.textContent = `Error: ${error.message}`;
  }
});

// Image loading and display logic
const fileInput = document.getElementById('file');
const canvas = document.getElementById('imageCanvas');
const ctx = canvas.getContext('2d');
let originalImage = null; // To store the original loaded image

// Editing control buttons
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
            if (disabled) {
                button.classList.add(...disabledClasses);
            } else {
                button.classList.remove(...disabledClasses);
            }
        }
    });
    if (resizeInput) {
        resizeInput.disabled = disabled;
        if (disabled) {
            resizeInput.classList.add(...disabledClasses);
        } else {
            resizeInput.classList.remove(...disabledClasses);
        }
    }
}
// Initially disable buttons
updateEditingButtonsState(true);

// Helper to display messages in paymentStatusContainer
function showPaymentStatus(message, type = 'info') {
    const container = document.getElementById('payment-status-container');
    const baseClasses = 'mb-4 p-3 rounded-md text-sm text-white';
    let colorClass = 'bg-blue-500'; // Default to info
    if (type === 'success') colorClass = 'bg-green-500';
    else if (type === 'error') colorClass = 'bg-red-500';

    container.className = `${baseClasses} ${colorClass}`;
    container.textContent = message;
    container.style.visibility = 'visible';
}

fileInput.addEventListener('change', (event) => {
    const paymentStatusContainer = document.getElementById('payment-status-container');
    const files = event.target.files;

    if (files.length === 0) {
        showPaymentStatus('No file selected. Please choose an image file.', 'error');
        originalImage = null;
        updateEditingButtonsState(true);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        fileInput.value = ''; // Clear the file input
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
                if (paymentStatusContainer.textContent.includes('Please select an image file') || paymentStatusContainer.textContent.includes('No file selected') || paymentStatusContainer.textContent.includes('Invalid file type')) {
                    paymentStatusContainer.textContent = 'Image loaded successfully.';
                    paymentStatusContainer.className = 'mb-4 p-3 rounded-md text-sm text-white bg-green-500';
                    // Optional: hide after a few seconds
                    // setTimeout(() => { paymentStatusContainer.style.visibility = 'hidden'; }, 3000);
                } else {
                     // If there was no error message related to file selection, don't show success, or keep existing message.
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
                originalImage = null;
                updateEditingButtonsState(true);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                fileInput.value = ''; // Clear the file input
            };
            img.src = reader.result;
        };
        reader.onerror = () => {
            showPaymentStatus('Error reading file. Please try again.', 'error');
            originalImage = null;
            updateEditingButtonsState(true);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            fileInput.value = ''; // Clear the file input
        };
        reader.readAsDataURL(file);
    } else {
        showPaymentStatus('Invalid file type. Please select an image file (e.g., PNG, JPG).', 'error');
        originalImage = null;
        updateEditingButtonsState(true);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        fileInput.value = ''; // Clear the file input
    }
});

// --- Image Editing Functions ---

// Function to redraw the original image (useful for reverting or complex operations)
function redrawOriginalImage() {
    if (!originalImage) {
        showPaymentStatus('No image loaded to redraw.', 'error');
        return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hRatio = canvas.width / originalImage.width;
    const vRatio = canvas.height / originalImage.height;
    const ratio = Math.min(hRatio, vRatio);
    const centerShift_x = (canvas.width - originalImage.width * ratio) / 2;
    const centerShift_y = (canvas.height - originalImage.height * ratio) / 2;
    ctx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height,
                  centerShift_x, centerShift_y, originalImage.width * ratio, originalImage.height * ratio);
}


// Rotation
function rotateCanvasContent(angleDegrees) { // This function seems to be unused, rotateCanvasContentFixedBounds is used.
    if (!originalImage) {
        showPaymentStatus('Please load an image first before trying to rotate.', 'error');
        return;
    }

    const tempImage = new Image(); // This function has issues with drawing tempImage vs originalImage.
    tempImage.onload = () => { // ... (rest of this function might need review if it were to be used)
        const oldCanvasWidth = canvas.width;
        const oldCanvasHeight = canvas.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(angleDegrees * Math.PI / 180);
        ctx.drawImage(tempImage, -tempImage.width / 2, -tempImage.height / 2);
        ctx.restore();
    };
    tempImage.src = canvas.toDataURL();
}

// More robust rotation that rotates the content within the *existing* canvas bounds
function rotateCanvasContentFixedBounds(angleDegrees) {
    if (!originalImage) {
        showPaymentStatus('Please load an image first before trying to rotate.', 'error');
        return;
    }
    // Check if canvas is blank (e.g. after a file error)
    try {
        if (ctx.getImageData(0,0,1,1).data[3] === 0) { // Check alpha of first pixel
             showPaymentStatus('Canvas is blank. Please load or re-load an image.', 'error');
             return;
        }
    } catch (e) {
        // This can happen if canvas is tainted or too small.
        console.warn("Could not verify canvas content for rotation via getImageData:", e.message);
        // Allow to proceed if originalImage is there, as it might be a drawing context issue.
    }


    if (!canvas.width || !canvas.height ) { // Should not happen if an image is loaded
        showPaymentStatus("Canvas not properly initialized for rotation.", 'error');
        return;
    }

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    let currentDataUrl;
    try {
        currentDataUrl = canvas.toDataURL();
    } catch (e) {
        showPaymentStatus(`Could not get canvas data for rotation: ${e.message}`, 'error');
        return;
    }

    const imgToRotate = new Image();
    imgToRotate.onload = () => {
        const w = canvas.width;
        const h = canvas.height;

        if (angleDegrees === 90 || angleDegrees === -90) {
            tempCanvas.width = h;
            tempCanvas.height = w;
            tempCtx.translate(h / 2, w / 2);
            tempCtx.rotate(angleDegrees * Math.PI / 180);
            tempCtx.drawImage(imgToRotate, -w / 2, -h / 2);
            canvas.width = h;
            canvas.height = w;
            ctx.clearRect(0,0,canvas.width, canvas.height);
            ctx.drawImage(tempCanvas, 0,0);
        } else {
            tempCanvas.width = w;
            tempCanvas.height = h;
            tempCtx.translate(w / 2, h / 2);
            tempCtx.rotate(angleDegrees * Math.PI / 180);
            tempCtx.drawImage(imgToRotate, -w / 2, -h / 2);
            ctx.clearRect(0,0,canvas.width, canvas.height);
            ctx.drawImage(tempCanvas, 0,0);
        }
    };
    imgToRotate.onerror = () => {
        showPaymentStatus('Error loading temporary image for rotation.', 'error');
    };
    imgToRotate.src = currentDataUrl;
}


document.getElementById('rotateLeftBtn').addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
document.getElementById('rotateRightBtn').addEventListener('click', () => rotateCanvasContentFixedBounds(90));


// Filters
document.getElementById('grayscaleBtn').addEventListener('click', () => {
    if (!originalImage) { showPaymentStatus("Please load an image first to apply grayscale.", 'error'); return; }
    try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
        }
        ctx.putImageData(imageData, 0, 0);
    } catch (e) {
        showPaymentStatus(`Error applying grayscale: ${e.message}. Canvas may be tainted if image is from another domain and server CORS is not set.`, 'error');
    }
});

document.getElementById('sepiaBtn').addEventListener('click', () => {
    if (!originalImage) { showPaymentStatus("Please load an image first to apply sepia.", 'error'); return; }
    try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
            data[i+1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
            data[i+2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        }
        ctx.putImageData(imageData, 0, 0);
    } catch (e) {
        showPaymentStatus(`Error applying sepia: ${e.message}. Canvas may be tainted.`, 'error');
    }
});


// Resize
document.getElementById('resizeBtn').addEventListener('click', () => {
    if (!originalImage) {
        showPaymentStatus("Please load an image first before resizing.", 'error');
        return;
    }

    const percentageText = resizeInput.value;
    if (!percentageText.endsWith('%')) {
        showPaymentStatus("Resize input must be a percentage (e.g., '50%').", 'error');
        return;
    }

    const percentage = parseFloat(percentageText.replace('%', ''));

    if (isNaN(percentage) || percentage <= 0) {
        showPaymentStatus("Please enter a valid positive percentage for resize.", 'error');
        return;
    }

    const newWidth = originalImage.width * (percentage / 100);
    const newHeight = originalImage.height * (percentage / 100);

    if (newWidth <= 0 || newHeight <= 0 || newWidth > 10000 || newHeight > 10000) { // Added upper bound check
        showPaymentStatus("Calculated resize dimensions are invalid or too large.", 'error');
        return;
    }

    canvas.width = newWidth;
    canvas.height = newHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);
    resizeInput.value = '';
    showPaymentStatus(`Image resized to ${percentage}%.`, 'success');
    // setTimeout(() => { if (document.getElementById('payment-status-container').textContent.includes('resized')) showPaymentStatus('', 'info'); }, 3000);

});

// Basic Crop (center 50% of original image)
document.getElementById('startCropBtn').addEventListener('click', () => {
    if (!originalImage) {
        showPaymentStatus("Please load an image first before cropping.", 'error');
        return;
    }

    const cropWidth = originalImage.width / 2;
    const cropHeight = originalImage.height / 2;
    const cropX = originalImage.width / 4;
    const cropY = originalImage.height / 4;

    if (cropWidth <= 0 || cropHeight <= 0) {
        showPaymentStatus("Original image is too small to perform this crop.", 'error');
        return;
    }

    canvas.width = cropWidth;
    canvas.height = cropHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    showPaymentStatus("Image cropped to central 50%.", 'success');
    // setTimeout(() => { if (document.getElementById('payment-status-container').textContent.includes('cropped')) showPaymentStatus('', 'info'); }, 3000);
});
