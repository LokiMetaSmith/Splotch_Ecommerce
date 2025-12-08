import { SVGParser } from './lib/svgparser.js';

// index.js

const appId = "sandbox-sq0idb-tawTw_Vl7VGYI6CZfKEshA";
const locationId = "LTS82DEX24XR0";
const serverUrl = 'http://localhost:3000'; // Define server URL once

// Declare globals for SDK objects and key DOM elements
let payments, card, csrfToken;
let originalImage = null;
let canvas, ctx;

// Globals for SVG processing state
let basePolygons = []; // The original, unscaled polygons from the SVG
let currentPolygons = [];
let isMetric = false; // To track unit preference
let currentCutline = [];
let currentBounds = null;
let pricingConfig = null;
let isGrayscale = false;
let isSepia = false;

let textInput, textSizeInput, textColorInput, addTextBtn, textFontFamilySelect;
let stickerMaterialSelect, stickerResolutionSelect, designMarginNote, stickerQuantityInput, calculatedPriceDisplay;
let paymentStatusContainer, ipfsLinkContainer, fileInputGlobalRef, paymentFormGlobalRef, fileNameDisplayEl;
let rotateLeftBtnEl, rotateRightBtnEl, resizeInputEl, resizeBtnEl, grayscaleBtnEl, sepiaBtnEl;

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
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    const initialWidth = canvas.width;
    const initialHeight = canvas.height;
    canvas.style.width = `${initialWidth}px`;
    canvas.style.height = `${initialHeight}px`;
    setCanvasSize(initialWidth, initialHeight);

    textInput = document.getElementById('textInput');
    textSizeInput = document.getElementById('textSizeInput');
    textColorInput = document.getElementById('textColorInput');
    addTextBtn = document.getElementById('addTextBtn');
    textFontFamilySelect = document.getElementById('textFontFamily');
    stickerMaterialSelect = document.getElementById('stickerMaterial');
    stickerResolutionSelect = document.getElementById('stickerResolution');
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
    const resizeSliderEl = document.getElementById('resizeSlider');
    const resizeValueEl = document.getElementById('resizeValue');
    grayscaleBtnEl = document.getElementById('grayscaleBtn');
    sepiaBtnEl = document.getElementById('sepiaBtn');

    // Fetch CSRF token and pricing info
    await Promise.all([
        fetchCsrfToken(),
        fetchPricingInfo()
    ]);

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
    if (stickerResolutionSelect) {
        stickerResolutionSelect.addEventListener('change', calculateAndUpdatePrice);
    }
    if (addTextBtn) {
        addTextBtn.addEventListener('click', handleAddText);
    }
    if (rotateLeftBtnEl) rotateLeftBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
    if (rotateRightBtnEl) rotateRightBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(90));
    if (grayscaleBtnEl) grayscaleBtnEl.addEventListener('click', toggleGrayscaleFilter);
    if (sepiaBtnEl) sepiaBtnEl.addEventListener('click', toggleSepiaFilter);
    if (resizeSliderEl) {
        resizeSliderEl.addEventListener('input', (e) => {
            let value = parseFloat(e.target.value);
            if (isMetric) {
                if(resizeValueEl) resizeValueEl.textContent = `${value.toFixed(1)} mm`;
                handleStandardResize(value / 25.4);
            } else {
                if(resizeValueEl) resizeValueEl.textContent = `${value.toFixed(1)} in`;
                handleStandardResize(value);
            }
        });
    }
    const generateCutlineBtn = document.getElementById('generateCutlineBtn');
    if(generateCutlineBtn) generateCutlineBtn.addEventListener('click', handleGenerateCutline);

    const standardSizesContainer = document.getElementById('standard-sizes-controls');
    if (standardSizesContainer) {
        standardSizesContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('size-btn')) {
                const targetInches = parseFloat(e.target.dataset.size);
                handleStandardResize(targetInches);

                // Also update the slider
                const resizeSliderEl = document.getElementById('resizeSlider');
                const resizeValueEl = document.getElementById('resizeValue');
                if (resizeSliderEl && resizeValueEl) {
                    if (isMetric) {
                        resizeSliderEl.value = targetInches * 25.4;
                        resizeValueEl.textContent = `${(targetInches * 25.4).toFixed(1)} mm`;
                    } else {
                        resizeSliderEl.value = targetInches;
                        resizeValueEl.textContent = `${targetInches.toFixed(1)} in`;
                    }
                }
            }
        });
    }

    const unitToggle = document.getElementById('unitToggle');
    if (unitToggle) {
        unitToggle.addEventListener('change', (e) => {
            isMetric = e.target.checked;
            updateUnitUI(isMetric);
            // Only redraw if there's something to draw
            if (originalImage || currentPolygons.length > 0) {
                calculateAndUpdatePrice();
                redrawAll();
            }
        });
    }

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
function calculatePerimeter(polygons) {
    let totalPerimeter = 0;
    const distance = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    polygons.forEach(poly => {
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length]; // Wrap around to the first point
            totalPerimeter += distance(p1, p2);
        }
    });
    return totalPerimeter;
}

function calculateStickerPrice(quantity, material, bounds, cutline, resolution) {
    if (!pricingConfig) {
        console.error("Pricing config not loaded.");
        return { total: 0, complexityMultiplier: 1.0 };
    }
    if (quantity <= 0) return { total: 0, complexityMultiplier: 1.0 };
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { total: 0, complexityMultiplier: 1.0 };
    if (!resolution) return { total: 0, complexityMultiplier: 1.0 };

    const ppi = resolution.ppi;
    const squareInches = (bounds.width / ppi) * (bounds.height / ppi);

    const basePriceCents = squareInches * pricingConfig.pricePerSquareInchCents;

    // Get material multiplier
    const materialInfo = pricingConfig.materials.find(m => m.id === material);
    const materialMultiplier = materialInfo ? materialInfo.costMultiplier : 1.0;

    // Get complexity multiplier
    const perimeterPixels = calculatePerimeter(cutline);
    const perimeterInches = perimeterPixels / ppi;
    let complexityMultiplier = 1.0;
    // Sort tiers ascending to find the first one the perimeter is less than.
    const sortedTiers = [...pricingConfig.complexity.tiers].sort((a,b) => (a.thresholdInches === 'Infinity' ? 1 : b.thresholdInches === 'Infinity' ? -1 : a.thresholdInches - b.thresholdInches));
    for (const tier of sortedTiers) {
        // Find the first tier that the perimeter is less than or equal to.
        if (perimeterInches <= tier.thresholdInches) {
            complexityMultiplier = tier.multiplier;
            break;
        }
    }

    // Get quantity discount
    let discount = 0;
    const sortedDiscounts = [...pricingConfig.quantityDiscounts].sort((a, b) => b.quantity - a.quantity);
    for (const tier of sortedDiscounts) {
        if (quantity >= tier.quantity) {
            discount = tier.discount;
            break;
        }
    }

    const resolutionMultiplier = resolution.costMultiplier;
    const totalCents = basePriceCents * quantity * materialMultiplier * complexityMultiplier * resolutionMultiplier;
    const discountedTotal = totalCents * (1 - discount);

    return {
        total: Math.round(discountedTotal),
        complexityMultiplier: complexityMultiplier
    };
}


function calculateAndUpdatePrice() {
    if (!pricingConfig || !stickerQuantityInput || !calculatedPriceDisplay || !stickerResolutionSelect) {
        return;
    }

    const selectedMaterial = stickerMaterialSelect.value;
    const selectedResolutionId = stickerResolutionSelect.value;
    const selectedResolution = pricingConfig.resolutions.find(r => r.id === selectedResolutionId);

    const quantity = parseInt(stickerQuantityInput.value, 10);
    const bounds = currentBounds;
    const cutline = currentCutline;

    if (isNaN(quantity) || quantity < 0) {
        currentOrderAmountCents = 0;
        calculatedPriceDisplay.textContent = quantity < 0 ? "Invalid Quantity" : formatPrice(0);
        return;
    }

    if (!bounds || !cutline || !selectedResolution) {
        currentOrderAmountCents = 0;
        calculatedPriceDisplay.innerHTML = `Price: <span class="text-gray-500">---</span>`;
        return;
    }

    const priceResult = calculateStickerPrice(quantity, selectedMaterial, bounds, cutline, selectedResolution);
    currentOrderAmountCents = priceResult.total;

    const ppi = selectedResolution.ppi;
    let width = (bounds.width / ppi);
    let height = (bounds.height / ppi);
    let unit = 'in';

    if (isMetric) {
        width *= 25.4;
        height *= 25.4;
        unit = 'mm';
    }

    calculatedPriceDisplay.innerHTML = `
        <span class="font-bold text-lg">${formatPrice(currentOrderAmountCents)}</span>
        <span class="text-sm text-gray-600 block">
            Size: ${width.toFixed(1)}${unit} x ${height.toFixed(1)}${unit}
        </span>
        <span class="text-xs text-gray-500 block">
            Complexity Modifier: x${priceResult.complexityMultiplier}
        </span>
    `;
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

// --- Config Fetching ---
function populateResolutionDropdown() {
    if (!pricingConfig || !stickerResolutionSelect) return;
    stickerResolutionSelect.innerHTML = ''; // Clear existing options
    pricingConfig.resolutions.forEach(res => {
        const option = document.createElement('option');
        option.value = res.id;
        option.textContent = res.name;
        stickerResolutionSelect.appendChild(option);
    });
    // Set a default selection
    stickerResolutionSelect.value = 'dpi_300';
}

async function fetchPricingInfo() {
    try {
        const response = await fetch(`${serverUrl}/api/pricing-info`);
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        pricingConfig = await response.json();
        console.log('[CLIENT] Pricing config loaded:', pricingConfig);
        // Once config is loaded, populate the dropdown
        populateResolutionDropdown();
    } catch (error) {
        console.error('[CLIENT] Error fetching pricing info:', error);
        showPaymentStatus('Could not load pricing information. Please refresh.', 'error');
    }
}

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
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, _csrf: csrfToken }),
        });

        if (!authResponse.ok) {
            const errorData = await authResponse.json().catch(() => ({})); // Catch JSON parsing errors
            if (errorData.error && errorData.error.includes('csrf')) {
                console.warn('[CLIENT] CSRF token was invalid during auth token issuance. Fetching a new one.');
                await fetchCsrfToken(); // Fetch a new token
                showPaymentStatus('Your session expired. It has been refreshed. Please try submitting again.', 'error');
                return; // Stop the submission process
            }
            throw new Error(`Could not issue a temporary authentication token. Server responded with: ${errorData.error || authResponse.statusText}`);
        }
        const { token: tempAuthToken } = await authResponse.json();
        if (!tempAuthToken) {
            throw new Error('Temporary authentication token was not received.');
        }
        console.log('[CLIENT] Temporary auth token received.');
        await fetchCsrfToken(); 
        if (!csrfToken) {
            throw new Error('Could not retrieve a new security token for file upload.');
        }
        // 1. Get image data from canvas as a Blob
        const designImageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!designImageBlob) {
            throw new Error("Could not get image data from canvas.");
        }

        // 2. Upload the design image and optional cut line file
        showPaymentStatus('Uploading design...', 'info');
        const uploadFormData = new FormData();
        uploadFormData.append('designImage', designImageBlob, 'design.png');
        uploadFormData.append('_csrf', csrfToken); // Add CSRF token to form data

        const cutLineFileInput = document.getElementById('cutLineFile');
        if (cutLineFileInput && cutLineFileInput.files[0]) {
            uploadFormData.append('cutLineFile', cutLineFileInput.files[0]);
        }

        const uploadResponse = await fetch(`${serverUrl}/api/upload-design`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Authorization': `Bearer ${tempAuthToken}`,
                'X-CSRF-Token': csrfToken 
            },
            body: uploadFormData,
        });

        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
            throw new Error(uploadData.error || 'Failed to upload design.');
        }
        const designImagePath = uploadData.designImagePath;
        const cutLinePath = uploadData.cutLinePath;
        console.log('[CLIENT] Design uploaded. Path:', designImagePath);
        if (cutLinePath) {
            console.log('[CLIENT] Cut line uploaded. Path:', cutLinePath);
        }

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

        // 3. Tokenize the card with verification details
        showPaymentStatus('Securing card details...', 'info');
        console.log('[CLIENT] Tokenizing card with verification details.');

        // UPDATED: Pass the new verificationDetails object to tokenize
        const sourceId = await tokenize(card, verificationDetails);

        console.log('[CLIENT] Tokenization successful. Nonce (sourceId):', sourceId);

        // 4. Create JSON payload for the order
        const orderDetails = {
            quantity: stickerQuantityInput ? parseInt(stickerQuantityInput.value, 10) : 0,
            material: stickerMaterialSelect ? stickerMaterialSelect.value : 'unknown',
            cutLinePath: cutLinePath,
        };

        const orderPayload = {
            sourceId,
            amountCents: currentOrderAmountCents,
            currency: 'USD',
            designImagePath,
            orderDetails,
            billingContact,
            _csrf: csrfToken // Add CSRF token to payload
        };

        // 5. Submit the order to the server
        showPaymentStatus('Submitting order to server...', 'info');
        console.log('[CLIENT] Submitting order to server at /api/create-order');

        const response = await fetch(`${serverUrl}/api/create-order`, {
            method: 'POST',
            credentials: 'include', // Important for cookies
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tempAuthToken}`
            },
            body: JSON.stringify(orderPayload),
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
        showPaymentStatus(`Order successfully placed! Redirecting to your order history...`, 'success');

        // Redirect to the order history page with the token
        setTimeout(() => {
            window.location.href = `/orders.html?token=${tempAuthToken}`;
        }, 2000);

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

function updateUnitUI(isMetric) {
    const inchesToMm = 25.4;
    const sizeBtns = document.querySelectorAll('.size-btn');
    const resizeSliderEl = document.getElementById('resizeSlider');
    const resizeValueEl = document.getElementById('resizeValue');
    const designMarginNoteEl = document.getElementById('designMarginNote');

    sizeBtns.forEach(btn => {
        const inches = parseFloat(btn.dataset.size);
        if (isMetric) {
            btn.textContent = `${(inches * inchesToMm).toFixed(0)}mm`;
        } else {
            btn.textContent = `${inches}"`;
        }
    });

    if (resizeSliderEl && resizeValueEl) {
        let currentValue = parseFloat(resizeSliderEl.value);
        if (isMetric) {
            if (!resizeSliderEl.dataset.originalMin) {
                resizeSliderEl.dataset.originalMin = resizeSliderEl.min;
                resizeSliderEl.dataset.originalMax = resizeSliderEl.max;
                resizeSliderEl.dataset.originalStep = resizeSliderEl.step;
            }
            resizeSliderEl.min = resizeSliderEl.dataset.originalMin * inchesToMm;
            resizeSliderEl.max = resizeSliderEl.dataset.originalMax * inchesToMm;
            resizeSliderEl.step = resizeSliderEl.dataset.originalStep * inchesToMm / 10;
            resizeSliderEl.value = currentValue * inchesToMm;
            resizeValueEl.textContent = `${(currentValue * inchesToMm).toFixed(1)} mm`;
        } else {
            if (resizeSliderEl.dataset.originalMin) {
                resizeSliderEl.min = resizeSliderEl.dataset.originalMin;
                resizeSliderEl.max = resizeSliderEl.dataset.originalMax;
                resizeSliderEl.step = resizeSliderEl.dataset.originalStep;
                resizeSliderEl.value = currentValue / inchesToMm;
                resizeValueEl.textContent = `${(currentValue / inchesToMm).toFixed(1)} in`;
            }
        }
    }

    if (designMarginNoteEl) {
        if (isMetric) {
            designMarginNoteEl.textContent = 'Keep important elements 2-3mm from edge!';
        } else {
            designMarginNoteEl.textContent = 'Keep important elements 0.08-0.12in from edge!';
        }
    }
}

function updateEditingButtonsState(disabled) {
    const elements = [
        rotateLeftBtnEl, rotateRightBtnEl, grayscaleBtnEl, sepiaBtnEl,
        document.getElementById('resizeSlider'), document.getElementById('generateCutlineBtn'),
        textInput, textSizeInput, textColorInput, addTextBtn, textFontFamilySelect
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

function setCanvasSize(logicalWidth, logicalHeight) {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;

    // Set the "actual" size of the canvas in device pixels
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;

    // Scale the context to account for the higher resolution.
    // Using setTransform ensures this is not cumulative.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// --- Image Loading and Editing Functions ---
function handleFileChange(event) {
    const file = event.target.files[0];
    if (file) {
        loadFileAsImage(file);
    }
}

function loadFileAsImage(file) {
    if (!file) return;

    if (fileNameDisplayEl) fileNameDisplayEl.textContent = file.name;
    const reader = new FileReader();

    // Handle SVGs differently from other images
    if (file.type === 'image/svg+xml') {
        // Reset raster image state
        originalImage = null;
        reader.onload = (e) => {
            handleSvgUpload(e.target.result);
        };
        reader.onerror = () => showPaymentStatus('Error reading SVG file.', 'error');
        reader.readAsText(file);
    } else if (file.type.startsWith('image/')) {
        // Reset vector state
        currentPolygons = [];
        basePolygons = [];
        currentCutline = [];
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
                    setCanvasSize(newWidth, newHeight);
                    ctx.clearRect(0, 0, newWidth, newHeight);
                    ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

                    // For raster images, the bounds and cutline are the canvas itself.
                    currentBounds = { left: 0, top: 0, right: newWidth, bottom: newHeight, width: newWidth, height: newHeight };
                    currentCutline = [[
                        { x: 0, y: 0 },
                        { x: newWidth, y: 0 },
                        { x: newWidth, y: newHeight },
                        { x: 0, y: newHeight }
                    ]];
                    currentPolygons = []; // Clear any previous SVG data

                    // Update the price now that we have dimensions
                    calculateAndUpdatePrice();
                    drawCanvasDecorations(currentBounds); // Draw the initial bounding box, size indicator, and rulers
                }
            };
            img.onerror = () => showPaymentStatus('Error loading image data.', 'error');
            img.src = reader.result;
        };
        reader.onerror = () => showPaymentStatus('Error reading file.', 'error');
        reader.readAsDataURL(file);
    } else {
        showPaymentStatus('Invalid file type. Please select an image or SVG file.', 'error');
    }
}

function redrawAll() {
    if (currentPolygons.length === 0) {
        // Handle raster image redrawing if necessary (or do nothing if canvas is source of truth)
        return;
    }

    // Generate the cutline from the current state of the polygons
    const cutline = generateCutLine(currentPolygons, 10); // 10px offset

    // Store the results globally
    currentCutline = cutline;
    currentBounds = ClipperLib.JS.BoundsOfPaths(cutline);

    // --- VALIDATION ---
    // Ensure the bounds are valid before attempting to redraw the canvas
    if (!currentBounds || (currentBounds.right - currentBounds.left) <= 0 || (currentBounds.bottom - currentBounds.top) <= 0) {
        console.error("Invalid bounds calculated, aborting redraw.", currentBounds);
        // We don't show a user-facing error here because the calling function should have already done so.
        return;
    }

    // Set canvas size based on the final cutline bounds
    const logicalWidth = currentBounds.right - currentBounds.left + 40; // Add padding
    const logicalHeight = currentBounds.bottom - currentBounds.top + 40;
    setCanvasSize(logicalWidth, logicalHeight);
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    // Create an offset for drawing, so the shape isn't at the very edge
    const drawOffset = { x: -currentBounds.left + 20, y: -currentBounds.top + 20 };

    // Draw everything
    drawPolygonsToCanvas(currentPolygons, 'black', drawOffset);
    drawPolygonsToCanvas(currentCutline, 'red', drawOffset, true);
    drawCanvasDecorations(currentBounds, drawOffset);

    // After redrawing, the bounds may have changed, so update the price.
    calculateAndUpdatePrice();
}

function handleSvgUpload(svgText) {
    const parser = new SVGParser();
    try {
        parser.load(svgText);
        parser.cleanInput();

        const polygons = [];
        const elements = parser.svgRoot.querySelectorAll('path, rect, circle, ellipse, polygon, polyline');

        elements.forEach(element => {
            // polygonify will convert each shape to an array of points
            const poly = parser.polygonify(element);
            if (poly && poly.length > 0) {
                polygons.push(poly);
            }
        });

        if (polygons.length === 0) {
            throw new Error("No parsable shapes found in the SVG.");
        }

        // Generate the cutline
        const cutline = generateCutLine(polygons, 10); // 10px offset

        // Store the results globally
        basePolygons = polygons; // Store the original, unscaled polygons
        currentPolygons = polygons;
        currentCutline = cutline;
        // Calculate the bounds of the final cutline for pricing and display
        currentBounds = ClipperLib.JS.BoundsOfPaths(cutline);

        // Set canvas size based on the final cutline bounds
        canvas.width = currentBounds.right - currentBounds.left + 40; // Add padding
        canvas.height = currentBounds.bottom - currentBounds.top + 40;

        // Create an offset for drawing, so the shape isn't at the very edge
        const drawOffset = { x: -currentBounds.left + 20, y: -currentBounds.top + 20 };

        // Initial drawing
        redrawAll();

        showPaymentStatus('SVG processed and cutline generated.', 'success');
        updateEditingButtonsState(false); // Enable editing buttons

    } catch (error) {
        showPaymentStatus(`SVG Processing Error: ${error.message}`, 'error');
        console.error(error);
    }
}

function generateCutLine(polygons, offset) {
    const scale = 100; // Scale for integer precision
    const scaledPolygons = polygons.map(p => {
        return p.map(point => ({ X: point.x * scale, Y: point.y * scale }));
    });

    const co = new ClipperLib.ClipperOffset();
    const offsetted_paths = new ClipperLib.Paths();

    co.AddPaths(scaledPolygons, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    co.Execute(offsetted_paths, offset * scale);

    // Scale back down
    const cutline = offsetted_paths.map(p => {
        return p.map(point => ({ x: point.X / scale, y: point.Y / scale }));
    });

    return cutline;
}

function drawPolygonsToCanvas(polygons, style, offset = { x: 0, y: 0 }, stroke = false) {
    if (!ctx) return;

    polygons.forEach(poly => {
        if (poly.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(poly[0].x + offset.x, poly[0].y + offset.y);
        for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(poly[i].x + offset.x, poly[i].y + offset.y);
        }
        ctx.closePath();

        if (stroke) {
            ctx.strokeStyle = style;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]); // Make the cutline dashed
            ctx.stroke();
            ctx.setLineDash([]); // Reset for other drawing operations
        } else {
            ctx.fillStyle = style;
            ctx.fill();
        }
    });
}

function drawCanvasDecorations(bounds, offset = { x: 0, y: 0 }) {
    if (!bounds) return;
    drawBoundingBox(bounds, offset);
    drawSizeIndicator(bounds, offset);
    drawRuler(bounds, offset);
}

function drawBoundingBox(bounds, offset = { x: 0, y: 0 }) {
    console.log('[DEBUG] drawBoundingBox called with:', { bounds, offset, hasCtx: !!ctx, hasPricing: !!pricingConfig });
    if (!ctx || !bounds || !pricingConfig) {
        console.log('[DEBUG] drawBoundingBox aborting due to missing dependencies');
        return;
    }

    // The user wanted a grey box with 1-inch dashes for pricing.
    // The previous implementation calculated a dash length from PPI, which was often
    // too large to be visible on smaller images. A fixed dash pattern is more reliable.

    // Set color to grey as requested.
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.9)'; // A strong, visible grey
    ctx.lineWidth = 2; // A clean, visible line width

    // Use a fixed dash pattern that is visible at most scales.
    ctx.setLineDash([10, 5]);

    // Stroke is centered on the path, so we offset by half the line width to keep it inside/visible
    // especially when bounds are at (0,0) of the canvas.
    const halfLineWidth = ctx.lineWidth / 2;
    const x = bounds.left + offset.x + halfLineWidth;
    const y = bounds.top + offset.y + halfLineWidth;
    const w = bounds.width - ctx.lineWidth;
    const h = bounds.height - ctx.lineWidth;

    console.log('[DEBUG] strokeRect args:', { x, y, w, h, lineWidth: ctx.lineWidth, strokeStyle: ctx.strokeStyle });

    ctx.strokeRect(x, y, w, h);

    // Reset line dash for subsequent drawing operations.
    ctx.setLineDash([]);
}

function drawSizeIndicator(bounds, offset = { x: 0, y: 0 }) {
    if (!ctx || !bounds || !pricingConfig || !stickerResolutionSelect) return;

    const ppi = pricingConfig.resolutions.find(r => r.id === stickerResolutionSelect.value)?.ppi || 96;
    let width = (bounds.width / ppi);
    let height = (bounds.height / ppi);
    let unit = 'in';

    if (isMetric) {
        width *= 25.4;
        height *= 25.4;
        unit = 'mm';
    }

    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    // Position the text slightly above the top edge of the bounding box
    ctx.fillText(`${width.toFixed(1)} ${unit}`, offset.x + bounds.width / 2, offset.y - 10);

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.save();
    // Position the text slightly to the left of the left edge, rotated
    ctx.translate(offset.x - 10, offset.y + bounds.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${height.toFixed(1)} ${unit}`, 0, 0);
    ctx.restore();
}

function drawRuler(bounds, offset = { x: 0, y: 0 }) {
    if (!ctx || !bounds || !pricingConfig || !stickerResolutionSelect) return;

    const ppi = pricingConfig.resolutions.find(r => r.id === stickerResolutionSelect.value)?.ppi || 96;
    const majorMarkSpacing = isMetric ? 10 * ppi / 25.4 : ppi; // 10mm or 1in
    const minorMarkSpacing = isMetric ? majorMarkSpacing / 10 : majorMarkSpacing / 8; // 1mm or 1/8in

    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.font = "10px Arial";
    ctx.lineWidth = 1;

    // Top ruler
    for (let i = 0; i * minorMarkSpacing <= bounds.width; i++) {
        const x = offset.x + i * minorMarkSpacing;
        const y = offset.y - 10;
        const isMajorMark = i % (isMetric ? 10 : 8) === 0;
        const markHeight = isMajorMark ? 10 : 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + markHeight);
        ctx.stroke();
        if (isMajorMark && i > 0) {
            const label = isMetric ? (i / 10) : (i / 8);
            ctx.fillText(label, x - 3, y - 2);
        }
    }

    // Left ruler
    for (let i = 0; i * minorMarkSpacing <= bounds.height; i++) {
        const y = offset.y + i * minorMarkSpacing;
        const x = offset.x - 10;
        const isMajorMark = i % (isMetric ? 10 : 8) === 0;
        const markWidth = isMajorMark ? 10 : 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + markWidth, y);
        ctx.stroke();
        if (isMajorMark && i > 0) {
            const label = isMetric ? (i / 10) : (i / 8);
            ctx.fillText(label, x - 12, y + 3);
        }
    }

    ctx.restore();
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
    if (basePolygons.length > 0) {
        // SVG Vector Rotation
        const bounds = ClipperLib.JS.BoundsOfPaths(currentPolygons);
        const centerX = bounds.left + (bounds.right - bounds.left) / 2;
        const centerY = bounds.top + (bounds.bottom - bounds.top) / 2;
        const angleRad = angleDegrees * Math.PI / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);

        currentPolygons = currentPolygons.map(poly =>
            poly.map(point => {
                // Translate point to origin
                const translatedX = point.x - centerX;
                const translatedY = point.y - centerY;
                // Rotate point
                const rotatedX = translatedX * cos - translatedY * sin;
                const rotatedY = translatedX * sin + translatedY * cos;
                // Translate point back
                return { x: rotatedX + centerX, y: rotatedY + centerY };
            })
        );
        redrawAll();

    } else if (originalImage) {
        // Use the current canvas dimensions, which represent the scaled image size
        const w = canvas.width;
        const h = canvas.height;

        // Swap dimensions for 90/270 degree rotations
        const newW = (angleDegrees === 90 || angleDegrees === -90) ? h : w;
        const newH = (angleDegrees === 90 || angleDegrees === -90) ? w : h;

        // Create a new in-memory canvas to draw the rotated image on
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // Set the dimensions of the temp canvas to the new width and height
        tempCanvas.width = newW;
        tempCanvas.height = newH;

        // Translate to the center of the temp canvas, rotate, and draw the current canvas content
        tempCtx.translate(newW / 2, newH / 2);
        tempCtx.rotate(angleDegrees * Math.PI / 180);

        // Draw the image from the main canvas onto the temp canvas
        // This preserves all current transformations (scale, filters)
        tempCtx.drawImage(canvas, -w / 2, -h / 2);

        // Now, update the main canvas with the rotated image
        setCanvasSize(newW, newH);
        ctx.clearRect(0, 0, newW, newH);
        ctx.drawImage(tempCanvas, 0, 0);

        // Update bounds and price, and redraw the bounding box
        currentBounds = { left: 0, top: 0, right: newW, bottom: newH, width: newW, height: newH };
        calculateAndUpdatePrice();
        drawCanvasDecorations(currentBounds);
    }
}

function redrawOriginalImageWithFilters() {
    if (!originalImage || !ctx || !canvas) return;

    // Start with the fresh, original image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);

    // Apply filters based on state
    if (isGrayscale) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
        }
        ctx.putImageData(imageData, 0, 0);
    } else if (isSepia) {
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

    // Also redraw the bounding box and size indicator, which are cleared by the operation.
    if (currentBounds) {
        drawCanvasDecorations(currentBounds);
    }
}

function toggleGrayscaleFilter() {
    if (!canvas || !ctx || !originalImage) return;

    const wasOn = isGrayscale;
    isGrayscale = !wasOn; // Toggle state
    isSepia = false; // Ensure sepia is off

    redrawOriginalImageWithFilters();
}

function toggleSepiaFilter() {
    if (!canvas || !ctx || !originalImage) return;

    const wasOn = isSepia;
    isSepia = !wasOn; // Toggle state
    isGrayscale = false; // Ensure grayscale is off

    redrawOriginalImageWithFilters();
}

function handleStandardResize(targetInches) {
    if (!pricingConfig || (!originalImage && basePolygons.length === 0)) {
        showPaymentStatus('Please load an image first.', 'error');
        return;
    }

    const selectedResolution = pricingConfig.resolutions.find(r => r.id === stickerResolutionSelect.value);
    if (!selectedResolution) return;

    const ppi = selectedResolution.ppi;
    const targetPixels = targetInches * ppi;

    let currentMaxWidthPixels;
    if (basePolygons.length > 0) {
        const bounds = ClipperLib.JS.BoundsOfPaths(basePolygons);
        currentMaxWidthPixels = Math.max(bounds.width, bounds.height);
    } else {
        currentMaxWidthPixels = Math.max(originalImage.width, originalImage.height);
    }

    if (currentMaxWidthPixels <= 0) return;

    const scale = targetPixels / currentMaxWidthPixels;

    if (basePolygons.length > 0) {
        // SVG Vector Resizing - always scale from the original
        currentPolygons = basePolygons.map(poly =>
            poly.map(point => ({ x: point.x * scale, y: point.y * scale }))
        );
        redrawAll();
    } else if (originalImage) {
        // Raster Image Resizing - always use the original image to prevent quality loss
        const newWidth = originalImage.width * scale;
        const newHeight = originalImage.height * scale;

        if (newWidth > 0 && newHeight > 0) {
            setCanvasSize(newWidth, newHeight);
            ctx.clearRect(0, 0, newWidth, newHeight);
            ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

            // Update the bounds and cutline for the new raster size
            currentBounds = { left: 0, top: 0, right: newWidth, bottom: newHeight, width: newWidth, height: newHeight };
            currentCutline = [[ { x: 0, y: 0 }, { x: newWidth, y: 0 }, { x: newWidth, y: newHeight }, { x: 0, y: newHeight } ]];

            // Trigger the price update and redraw the bounding box
            calculateAndUpdatePrice();
            drawCanvasDecorations(currentBounds);
        }
    }
}

// --- Smart Cutline Generation ---

function imageHasTransparentBorder() {
    if (!canvas || !ctx) return false;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;
    const borderSampleSize = 10; // Check this many pixels on each edge

    const isTransparentOrWhite = (i) => {
        if (data[i+3] < 128) return true; // Alpha check
        if (data[i] > 250 && data[i+1] > 250 && data[i+2] > 250) return true; // White check
        return false;
    };

    // Check top and bottom borders
    for (let x = 0; x < width; x += Math.floor(width / borderSampleSize)) {
        if (!isTransparentOrWhite((0 * width + x) * 4) || !isTransparentOrWhite(((height - 1) * width + x) * 4)) {
            return false;
        }
    }
    // Check left and right borders
    for (let y = 0; y < height; y += Math.floor(height / borderSampleSize)) {
        if (!isTransparentOrWhite((y * width + 0) * 4) || !isTransparentOrWhite((y * width + (width - 1)) * 4)) {
            return false;
        }
    }
    return true;
}

function handleGenerateCutline() {
    if (!canvas || !ctx || !originalImage) {
        showPaymentStatus('Smart cutline requires a raster image (PNG, JPG). Please upload one.', 'error');
        return;
    }

    // --- Feedforward Check ---
    if (!imageHasTransparentBorder()) {
        const proceed = confirm("This image does not appear to have a transparent or white background. The 'Smart Cutline' feature may not produce a good result. Proceed anyway?");
        if (!proceed) {
            return;
        }
    }

    showPaymentStatus('Generating smart cutline...', 'info');

    // Save the current canvas state so we can restore it if tracing fails.
    const originalCanvasData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Use a timeout to allow the UI to update before the heavy computation
    setTimeout(() => {
        try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const contour = traceContour(imageData);

            if (!contour || contour.length < 3) {
                throw new Error("Could not find a distinct contour. Image may be empty or too complex.");
            }

            // The raw contour is too detailed, simplify it using the RDP algorithm.
            const simplifiedContour = simplifyPolygon(contour, 2.0); // Epsilon of 2.0 pixels

            // Clean the polygon to remove self-intersections and other issues before offsetting.
            // This requires scaling up for Clipper's integer math.
            const scale = 100;
            const scaledPoly = simplifiedContour.map(p => ({ X: p.x * scale, Y: p.y * scale }));
            const cleanedScaledPoly = ClipperLib.Clipper.CleanPolygon(scaledPoly, 1.415);

            // Add validation to ensure we have a usable polygon AFTER cleaning
            if (!cleanedScaledPoly || cleanedScaledPoly.length < 3) {
                throw new Error("Could not detect a usable outline. Try an image with a transparent background.");
            }

            const finalContour = cleanedScaledPoly.map(p => ({ x: p.X / scale, y: p.Y / scale }));

            basePolygons = [finalContour];
            currentPolygons = [finalContour];
            redrawAll();
            showPaymentStatus('Smart cutline generated successfully.', 'success');

        } catch (error) {
            // Restore the original canvas if the process failed
            ctx.putImageData(originalCanvasData, 0, 0);
            showPaymentStatus(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }, 50);
}

function traceContour(imageData) {
    const { data, width, height } = imageData;
    const isOpaque = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const a = data[i+3];

        // Treat pixels with low alpha as transparent
        if (a < 128) return false;
        // Treat pure white pixels as transparent
        if (r > 250 && g > 250 && b > 250) return false;

        return true; // Otherwise, pixel is opaque
    };

    // 1. Find the first non-transparent pixel
    let startPos = null;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (isOpaque(x, y)) {
                startPos = { x, y };
                break;
            }
        }
        if (startPos) break;
    }

    if (!startPos) {
        return null; // No opaque pixels found
    }

    const contour = [];
    let currentPos = startPos;
    let lastDirection = 6; // Start by checking the pixel to the left

    // Moore-Neighbor tracing algorithm
    const neighbors = [
        { x: 1, y: 0 },   // 0: E
        { x: 1, y: -1 },  // 1: NE
        { x: 0, y: -1 },  // 2: N
        { x: -1, y: -1 }, // 3: NW
        { x: -1, y: 0 },  // 4: W
        { x: -1, y: 1 },  // 5: SW
        { x: 0, y: 1 },   // 6: S
        { x: 1, y: 1 },   // 7: SE
    ];

    do {
        contour.push({ x: currentPos.x, y: currentPos.y });

        // Start checking neighbors from the one after the direction we came from
        let checkDirection = (lastDirection + 5) % 8;
        let nextPos = null;
        let foundNext = false;

        for (let i = 0; i < 8; i++) {
            const neighborOffset = neighbors[checkDirection];
            const neighborPos = { x: currentPos.x + neighborOffset.x, y: currentPos.y + neighborOffset.y };

            if (isOpaque(neighborPos.x, neighborPos.y)) {
                nextPos = neighborPos;
                lastDirection = checkDirection;
                foundNext = true;
                break;
            }
            checkDirection = (checkDirection + 1) % 8;
        }

        if (!foundNext) {
            // This can happen on a 1px line, we just stop.
            break;
        }

        currentPos = nextPos;

    } while (currentPos.x !== startPos.x || currentPos.y !== startPos.y);

    return contour;
}

// --- Path Simplification (Ramer-Douglas-Peucker) ---

function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    if (dx === 0 && dy === 0) {
        return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
    }
    const numerator = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
    const denominator = Math.sqrt(dx * dx + dy * dy);
    return numerator / denominator;
}

function rdp(points, epsilon) {
    let dmax = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(points[i], points[0], points[end]);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    if (dmax > epsilon) {
        const recResults1 = rdp(points.slice(0, index + 1), epsilon);
        const recResults2 = rdp(points.slice(index, end + 1), epsilon);
        return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
    } else {
        return [points[0], points[end]];
    }
}

function simplifyPolygon(points, epsilon = 1.0) {
    if (points.length < 3) return points;
    return rdp(points, epsilon);
}
