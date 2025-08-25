import { SVGParser } from './lib/svgparser.js';

// index.js

const appId = "sandbox-sq0idb-tawTw_Vl7VGYI6CZfKEshA";
const locationId = "LTS82DEX24XR0";
const serverUrl = 'http://localhost:3000'; // Define server URL once

// Declare globals for SDK objects and key DOM elements
let payments, card, csrfToken;
let originalImage = null;
let canvas, ctx;
let fullResCanvas; // In-memory canvas for full-resolution image

// Globals for SVG processing state
let basePolygons = []; // The original, unscaled polygons from the SVG
let currentPolygons = [];
let isMetric = false; // To track unit preference
let currentCutline = [];
let currentBounds = null;
let pricingConfig = null;
let isGrayscale = false;
let isSepia = false;

// Globals for DOM elements that are frequently accessed
let textInput, textSizeInput, textColorInput, addTextBtn, textFontFamilySelect;
let stickerMaterialSelect, stickerResolutionSelect, designMarginNote, stickerQuantityInput, calculatedPriceDisplay;
let ipfsLinkContainer, fileInputGlobalRef, paymentFormGlobalRef, fileNameDisplayEl;
let rotateLeftBtnEl, rotateRightBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl;

let currentOrderAmountCents = 0;

// --- Main Application Setup ---
async function BootStrap() {
    // Assign DOM elements from the new layout
    canvas = document.getElementById('imageCanvas');
    if (!canvas) {
        console.error("FATAL: imageCanvas element not found. Aborting BootStrap.");
        return; // Stop if the canvas isn't there
    }
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Card 2: Customize
    textInput = document.getElementById('textInput');
    textSizeInput = document.getElementById('textSizeInput');
    textColorInput = document.getElementById('textColorInput');
    addTextBtn = document.getElementById('addTextBtn');
    textFontFamilySelect = document.getElementById('textFontFamily');
    stickerMaterialSelect = document.getElementById('stickerMaterial');
    stickerResolutionSelect = document.getElementById('stickerResolution');
    stickerQuantityInput = document.getElementById('stickerQuantity');
    rotateLeftBtnEl = document.getElementById('rotateLeftBtn');
    rotateRightBtnEl = document.getElementById('rotateRightBtn');
    startCropBtnEl = document.getElementById('startCropBtn');
    grayscaleBtnEl = document.getElementById('grayscaleBtn');
    sepiaBtnEl = document.getElementById('sepiaBtn');
    const generateCutlineBtn = document.getElementById('generateCutlineBtn');
    const maxDimensionInput = document.getElementById('maxDimensionInput');
    const unitToggle = document.getElementById('unitToggle');

    // Card 1: Upload
    fileInputGlobalRef = document.getElementById('file');
    fileNameDisplayEl = document.getElementById('fileNameDisplay');
    const cutLineFileInput = document.getElementById('cutLineFile');
    designMarginNote = document.getElementById('designMarginNote');

    // Card 3: Payment
    paymentFormGlobalRef = document.getElementById('payment-form');

    // Persistent Summary
    calculatedPriceDisplay = document.getElementById('summary-cost');

    // Other elements
    ipfsLinkContainer = document.getElementById('ipfsLinkContainer');

    // The inline script in index.html now handles the unit toggle's DOM manipulation.
    // We just need to listen for changes to update our internal state and pricing.
    if (unitToggle) {
        unitToggle.addEventListener('change', (e) => {
            isMetric = e.target.checked;
            calculateAndUpdatePrice();
            redrawAll(); // Redraw canvas indicators if any
        });
    }

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
    }

    // Attach event listeners for customization and pricing
    if (stickerQuantityInput) stickerQuantityInput.addEventListener('input', calculateAndUpdatePrice);
    if (stickerMaterialSelect) stickerMaterialSelect.addEventListener('change', calculateAndUpdatePrice);
    if (stickerResolutionSelect) stickerResolutionSelect.addEventListener('change', calculateAndUpdatePrice);

    // Image editing
    if (addTextBtn) addTextBtn.addEventListener('click', handleAddText);
    if (rotateLeftBtnEl) rotateLeftBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(-90));
    if (rotateRightBtnEl) rotateRightBtnEl.addEventListener('click', () => rotateCanvasContentFixedBounds(90));
    if (grayscaleBtnEl) grayscaleBtnEl.addEventListener('click', toggleGrayscaleFilter);
    if (sepiaBtnEl) sepiaBtnEl.addEventListener('click', toggleSepiaFilter);
    if (startCropBtnEl) startCropBtnEl.addEventListener('click', handleCrop);
    if (generateCutlineBtn) generateCutlineBtn.addEventListener('click', handleGenerateCutline);

    // New resize logic
    if (maxDimensionInput) {
        maxDimensionInput.addEventListener('input', () => {
            const isMm = unitToggle.checked;
            const value = parseFloat(maxDimensionInput.value);
            handleDimensionResize(value, isMm);
        });
    }

    // File inputs
    if (fileInputGlobalRef) fileInputGlobalRef.addEventListener('change', handleFileChange);
    if (cutLineFileInput) cutLineFileInput.addEventListener('change', handleFileChange); // Assuming same handler for now

    // Drag-and-drop on canvas
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
            if (file) loadFileAsImage(file);
        });
    }

    // Paste from clipboard
    window.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) loadFileAsImage(file);
            }
        }
    });

    // Payment form submission
    if (paymentFormGlobalRef) {
        paymentFormGlobalRef.addEventListener('submit', handlePaymentFormSubmit);
    } else {
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
            showAdBlockerWarning();
        }
    }, 2000);

    // Rolodex functionality for mobile layout
    const rolodexContainer = document.getElementById('rolodex-container');
    if (rolodexContainer) {
        const cards = document.querySelectorAll('.rolodex-card');
        const nextBtn = document.getElementById('rolodex-next');
        const prevBtn = document.getElementById('rolodex-prev');
        const dotsContainer = document.getElementById('rolodex-dots');
        let currentIndex = 0;

        if (cards.length > 0 && nextBtn && prevBtn && dotsContainer) {
            cards.forEach((_, i) => {
                const dot = document.createElement('button');
                dot.classList.add('w-3', 'h-3', 'rounded-full', 'bg-gray-300', 'transition');
                dot.addEventListener('click', () => showCard(i));
                dotsContainer.appendChild(dot);
            });
            const dots = dotsContainer.querySelectorAll('button');

            function showCard(index) {
                if (cards[index]) {
                    rolodexContainer.style.height = cards[index].scrollHeight + 'px';
                    cards.forEach((card, i) => {
                        card.classList.toggle('active', i === index);
                    });
                    if (dots[index]) {
                         dots.forEach((d, i) => d.classList.toggle('bg-splotch-navy', i === index));
                    }
                    currentIndex = index;
                    prevBtn.disabled = currentIndex === 0;
                    nextBtn.disabled = currentIndex === cards.length - 1;
                }
            }

            nextBtn.addEventListener('click', () => {
                if (currentIndex < cards.length - 1) showCard(currentIndex + 1);
            });
            prevBtn.addEventListener('click', () => {
                if (currentIndex > 0) showCard(currentIndex - 1);
            });

            // Initial setup
            showCard(0);
        }
    }

    // Magnifying Glass Logic for mobile layout
    const magnifyContainer = document.getElementById('magnify-preview-container');
    if (magnifyContainer) {
        const thumbCanvas = document.getElementById('mobile-imageCanvas-thumb');
        const loupe = document.getElementById('magnify-loupe');
        const label = document.getElementById('magnify-label');

        if (thumbCanvas && loupe && label) {
            const updateMagnifier = (e) => {
                e.preventDefault();
                const rect = thumbCanvas.getBoundingClientRect();
                const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
                const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
                loupe.style.left = `${x - loupe.offsetWidth / 2}px`;
                loupe.style.top = `${y - loupe.offsetHeight / 2}px`;
                if (!fullResCanvas || fullResCanvas.width === 0 || thumbCanvas.width === 0) return;
                const ratioX = fullResCanvas.width / thumbCanvas.width;
                const ratioY = fullResCanvas.height / thumbCanvas.height;
                const bgX = -(x * ratioX - loupe.offsetWidth / 2);
                const bgY = -(y * ratioY - loupe.offsetHeight / 2);
                loupe.style.backgroundPosition = `${bgX}px ${bgY}px`;
            };

            const showMagnifier = () => {
                if (fullResCanvas) {
                    const dataURL = fullResCanvas.toDataURL();
                    loupe.style.backgroundImage = `url(${dataURL})`;
                    loupe.style.backgroundSize = `${fullResCanvas.width}px ${fullResCanvas.height}px`;
                    loupe.classList.remove('hidden');
                    label.classList.remove('hidden');
                }
            };

            const hideMagnifier = () => {
                loupe.classList.add('hidden');
                label.classList.add('hidden');
            };

            magnifyContainer.addEventListener('mouseenter', showMagnifier);
            magnifyContainer.addEventListener('mouseleave', hideMagnifier);
            magnifyContainer.addEventListener('mousemove', updateMagnifier);
            magnifyContainer.addEventListener('touchstart', (e) => { e.preventDefault(); showMagnifier(); }, { passive: false });
            magnifyContainer.addEventListener('touchend', hideMagnifier);
            magnifyContainer.addEventListener('touchmove', updateMagnifier, { passive: false });

            hideMagnifier(); // Initially hide it
        }
    }
});

function showAdBlockerWarning() {
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
    if (!pricingConfig || quantity <= 0 || !bounds || !resolution || bounds.width <= 0 || bounds.height <= 0) {
        return { total: 0, complexityMultiplier: 1.0 };
    }

    const ppi = resolution.ppi;
    const squareInches = (bounds.width / ppi) * (bounds.height / ppi);
    const basePriceCents = squareInches * pricingConfig.pricePerSquareInchCents;

    const materialInfo = pricingConfig.materials.find(m => m.id === material);
    const materialMultiplier = materialInfo ? materialInfo.costMultiplier : 1.0;

    const perimeterPixels = calculatePerimeter(cutline);
    const perimeterInches = perimeterPixels / ppi;
    let complexityMultiplier = 1.0;
    const sortedTiers = [...pricingConfig.complexity.tiers].sort((a,b) => (a.thresholdInches === 'Infinity' ? 1 : b.thresholdInches === 'Infinity' ? -1 : a.thresholdInches - b.thresholdInches));
    for (const tier of sortedTiers) {
        if (tier.thresholdInches === "Infinity" || perimeterInches < tier.thresholdInches) {
            complexityMultiplier = tier.multiplier;
            break;
        }
    }

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
    if (!pricingConfig || !stickerQuantityInput || !stickerResolutionSelect || !calculatedPriceDisplay) {
        return;
    }

    const selectedMaterial = stickerMaterialSelect.value;
    const selectedResolutionId = stickerResolutionSelect.value;
    const selectedResolution = pricingConfig.resolutions.find(r => r.id === selectedResolutionId);
    const quantity = parseInt(stickerQuantityInput.value, 10);

    if (isNaN(quantity) || quantity < 0 || !currentBounds || !currentCutline || !selectedResolution) {
        currentOrderAmountCents = 0;
        calculatedPriceDisplay.textContent = formatPrice(0);
        return;
    }

    const priceResult = calculateStickerPrice(quantity, selectedMaterial, currentBounds, currentCutline, selectedResolution);
    currentOrderAmountCents = priceResult.total;

    // Update summary header
    calculatedPriceDisplay.textContent = formatPrice(currentOrderAmountCents);
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
    stickerResolutionSelect.value = 'dpi_300'; // Set default
}

async function fetchPricingInfo() {
    try {
        const response = await fetch(`${serverUrl}/api/pricing-info`);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        pricingConfig = await response.json();
        console.log('[CLIENT] Pricing config loaded:', pricingConfig);
        populateResolutionDropdown();
    } catch (error) {
        console.error('[CLIENT] Error fetching pricing info:', error);
        showPaymentStatus('Could not load pricing information. Please refresh.', 'error');
    }
}

async function fetchCsrfToken() {
    try {
        const response = await fetch(`${serverUrl}/api/csrf-token`, { credentials: 'include' });
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (!data.csrfToken) throw new Error("CSRF token not found in server response");
        csrfToken = data.csrfToken;
        console.log('[CLIENT] CSRF Token fetched and stored.');
    } catch (error) {
        console.error('[CLIENT] Error fetching CSRF token:', error);
        showPaymentStatus('A security token could not be loaded. Please refresh the page to continue.', 'error');
    }
}


// --- Form Submission Logic ---
async function handlePaymentFormSubmit(event) {
    event.preventDefault();
    showPaymentStatus('Processing order...', 'info');

    if (!originalImage) {
        showPaymentStatus('Please upload a sticker design image before submitting.', 'error');
        return;
    }
    if (!csrfToken) {
        showPaymentStatus('Cannot submit form. A required security token is missing. Please refresh the page.', 'error');
        return;
    }

    const shippingEmail = document.getElementById('shippingEmail').value;
    if (!shippingEmail) {
        showPaymentStatus('Please enter a shipping email address to proceed.', 'error');
        return;
    }

    try {
        // 0. Get temporary auth token
        const authResponse = await fetch(`${serverUrl}/api/auth/issue-temp-token`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: shippingEmail, _csrf: csrfToken }),
        });

        if (!authResponse.ok) {
            const errorData = await authResponse.json().catch(() => ({}));
            if (errorData.error && errorData.error.includes('csrf')) {
                await fetchCsrfToken();
                showPaymentStatus('Your session expired. It has been refreshed. Please try submitting again.', 'error');
                return;
            }
            throw new Error(`Could not issue auth token: ${errorData.error || authResponse.statusText}`);
        }
        const { token: tempAuthToken } = await authResponse.json();
        if (!tempAuthToken) throw new Error('Temporary auth token was not received.');

        // 1. Get image data from canvas
        const designImageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!designImageBlob) throw new Error("Could not get image data from canvas.");

        // 2. Upload design
        const uploadFormData = new FormData();
        uploadFormData.append('designImage', designImageBlob, 'design.png');
        uploadFormData.append('_csrf', csrfToken);
        const cutLineFileInput = document.getElementById('cutLineFile');
        if (cutLineFileInput && cutLineFileInput.files[0]) {
            uploadFormData.append('cutLineFile', cutLineFileInput.files[0]);
        }

        const uploadResponse = await fetch(`${serverUrl}/api/upload-design`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Authorization': `Bearer ${tempAuthToken}`, 'X-CSRF-Token': csrfToken },
            body: uploadFormData,
        });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(uploadData.error || 'Failed to upload design.');

        // 3. Build billing contact and verification details
        const useDifferentBilling = document.querySelector('input[name="billingSameAsShipping"]:checked').value === 'no';
        const billingContact = {
            givenName: useDifferentBilling ? document.getElementById('billingFirstName').value : document.getElementById('shippingFirstName').value,
            familyName: useDifferentBilling ? document.getElementById('billingLastName').value : document.getElementById('shippingLastName').value,
            email: shippingEmail,
            phone: useDifferentBilling ? "" : document.getElementById('shippingPhone').value,
            addressLines: [useDifferentBilling ? document.getElementById('billingAddress').value : document.getElementById('shippingAddress').value],
            city: useDifferentBilling ? document.getElementById('billingCity').value : document.getElementById('shippingCity').value,
            state: useDifferentBilling ? document.getElementById('billingState').value : document.getElementById('shippingState').value,
            postalCode: useDifferentBilling ? document.getElementById('billingPostalCode').value : document.getElementById('shippingPostalCode').value,
            countryCode: "US",
        };

        const verificationDetails = {
            amount: (currentOrderAmountCents / 100).toFixed(2),
            currencyCode: 'USD',
            intent: 'CHARGE',
            billingContact: billingContact,
            customerInitiated: true,
            sellerKeyedIn: false,
        };

        // 4. Tokenize card
        const sourceId = await tokenize(card, verificationDetails);

        // 5. Create order payload
        const orderDetails = {
            quantity: stickerQuantityInput ? parseInt(stickerQuantityInput.value, 10) : 0,
            material: stickerMaterialSelect ? stickerMaterialSelect.value : 'unknown',
            cutLinePath: uploadData.cutLinePath,
        };

        const orderPayload = {
            sourceId,
            amountCents: currentOrderAmountCents,
            designImagePath: uploadData.designImagePath,
            orderDetails,
            billingContact,
            _csrf: csrfToken
        };

        // 6. Submit order
        const response = await fetch(`${serverUrl}/api/create-order`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tempAuthToken}` },
            body: JSON.stringify(orderPayload),
        });
        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData.error || 'Failed to create order on server.');

        showPaymentStatus(`Order successfully placed! Redirecting...`, 'success');
        setTimeout(() => { window.location.href = `/orders.html?token=${tempAuthToken}`; }, 2000);

    } catch (error) {
        console.error("[CLIENT] Error during payment form submission:", error);
        showPaymentStatus(`Error: ${error.message}`, 'error');
    }
}

// --- UI Helper Functions ---
function showPaymentStatus(message, type = 'info') {
    const statusContainer = document.getElementById('payment-status-container');
    if (!statusContainer) {
        // Fallback for critical errors when the container might not be available
        const prefix = type === 'error' ? 'Error: ' : (type === 'success' ? 'Success: ' : '');
        alert(prefix + message);
        console.log(`[Payment Status] ${type}: ${message}`);
        return;
    }

    statusContainer.textContent = message;
    statusContainer.style.visibility = 'visible';

    // Clear existing type classes
    statusContainer.classList.remove('bg-green-500', 'bg-red-500', 'bg-blue-500', 'text-white');

    // Apply new type class
    switch (type) {
        case 'success':
            statusContainer.classList.add('bg-green-500', 'text-white');
            break;
        case 'error':
            statusContainer.classList.add('bg-red-500', 'text-white');
            break;
        default: // 'info'
            statusContainer.classList.add('bg-blue-500', 'text-white');
            break;
    }

    // Hide the message after 5 seconds
    setTimeout(() => {
        statusContainer.style.visibility = 'hidden';
    }, 5000);
}

function updateEditingButtonsState(disabled) {
    const elements = [
        rotateLeftBtnEl, rotateRightBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl,
        document.getElementById('generateCutlineBtn'), document.getElementById('maxDimensionInput'),
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

function updateThumbnail() {
    const thumbnailCanvas = document.getElementById('thumbnail-canvas');
    if (!thumbnailCanvas || !canvas) return;
    const thumbCtx = thumbnailCanvas.getContext('2d');
    thumbCtx.clearRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
    thumbCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
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

    if (file.type === 'image/svg+xml') {
        originalImage = null;
        reader.onload = (e) => handleSvgUpload(e.target.result);
        reader.onerror = () => showPaymentStatus('Error reading SVG file.', 'error');
        reader.readAsText(file);
    } else if (file.type.startsWith('image/')) {
        currentPolygons = []; basePolygons = []; currentCutline = [];
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                originalImage = img;

                // Create an in-memory canvas for the full-resolution image
                fullResCanvas = document.createElement('canvas');
                fullResCanvas.width = img.width;
                fullResCanvas.height = img.height;
                const fullResCtx = fullResCanvas.getContext('2d');
                fullResCtx.drawImage(img, 0, 0);

                updateEditingButtonsState(false);
                showPaymentStatus('Image loaded successfully.', 'success');

                const maxWidth = 500, maxHeight = 400;
                let newWidth = img.width, newHeight = img.height;
                if (newWidth > maxWidth) { const r = maxWidth / newWidth; newWidth = maxWidth; newHeight *= r; }
                if (newHeight > maxHeight) { const r = maxHeight / newHeight; newHeight = maxHeight; newWidth *= r; }

                canvas.width = newWidth;
                canvas.height = newHeight;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);

                currentBounds = { left: 0, top: 0, right: newWidth, bottom: newHeight, width: newWidth, height: newHeight };
                currentCutline = [[{ x: 0, y: 0 }, { x: newWidth, y: 0 }, { x: newWidth, y: newHeight }, { x: 0, y: newHeight }]];

                calculateAndUpdatePrice();
                drawBoundingBox(currentBounds);
                updateThumbnail();
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
        if(originalImage) {
            // This is a raster image, re-apply filters if any
            redrawOriginalImageWithFilters();
        }
        return;
    }

    const cutline = generateCutLine(currentPolygons, 10);
    currentCutline = cutline;
    currentBounds = ClipperLib.JS.BoundsOfPaths(cutline);

    if (!currentBounds || (currentBounds.right - currentBounds.left) <= 0 || (currentBounds.bottom - currentBounds.top) <= 0) {
        console.error("Invalid bounds calculated, aborting redraw.", currentBounds);
        return;
    }

    canvas.width = currentBounds.right - currentBounds.left + 40;
    canvas.height = currentBounds.bottom - currentBounds.top + 40;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const drawOffset = { x: -currentBounds.left + 20, y: -currentBounds.top + 20 };

    drawPolygonsToCanvas(currentPolygons, 'black', drawOffset);
    drawPolygonsToCanvas(currentCutline, 'red', drawOffset, true);
    drawBoundingBox(currentBounds, drawOffset);

    calculateAndUpdatePrice();
    updateThumbnail();
}

function handleSvgUpload(svgText) {
    const parser = new SVGParser();
    try {
        parser.load(svgText);
        parser.cleanInput();
        const polygons = [];
        const elements = parser.svgRoot.querySelectorAll('path, rect, circle, ellipse, polygon, polyline');
        elements.forEach(element => {
            const poly = parser.polygonify(element);
            if (poly && poly.length > 0) polygons.push(poly);
        });

        if (polygons.length === 0) throw new Error("No parsable shapes found in the SVG.");

        basePolygons = polygons;
        currentPolygons = polygons;
        redrawAll();
        showPaymentStatus('SVG processed and cutline generated.', 'success');
        updateEditingButtonsState(false);
    } catch (error) {
        showPaymentStatus(`SVG Processing Error: ${error.message}`, 'error');
        console.error(error);
    }
}

function generateCutLine(polygons, offset) {
    const scale = 100;
    const scaledPolygons = polygons.map(p => p.map(point => ({ X: point.x * scale, Y: point.y * scale })));
    const co = new ClipperLib.ClipperOffset();
    const offsetted_paths = new ClipperLib.Paths();
    co.AddPaths(scaledPolygons, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    co.Execute(offsetted_paths, offset * scale);
    return offsetted_paths.map(p => p.map(point => ({ x: point.X / scale, y: point.Y / scale })));
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
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            ctx.fillStyle = style;
            ctx.fill();
        }
    });
}

function drawBoundingBox(bounds, offset = { x: 0, y: 0 }) {
    if (!ctx || !bounds) return;
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(bounds.left + offset.x, bounds.top + offset.y, bounds.width, bounds.height);
    ctx.setLineDash([]);
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
    updateThumbnail();
}

function rotateCanvasContentFixedBounds(angleDegrees) {
    if (basePolygons.length > 0) {
        const bounds = ClipperLib.JS.BoundsOfPaths(currentPolygons);
        const centerX = bounds.left + (bounds.right - bounds.left) / 2;
        const centerY = bounds.top + (bounds.bottom - bounds.top) / 2;
        const angleRad = angleDegrees * Math.PI / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        currentPolygons = currentPolygons.map(poly =>
            poly.map(point => {
                const translatedX = point.x - centerX;
                const translatedY = point.y - centerY;
                const rotatedX = translatedX * cos - translatedY * sin;
                const rotatedY = translatedX * sin + translatedY * cos;
                return { x: rotatedX + centerX, y: rotatedY + centerY };
            })
        );
        redrawAll();
    } else if (originalImage) {
        const w = canvas.width, h = canvas.height;
        const newW = (angleDegrees === 90 || angleDegrees === -90) ? h : w;
        const newH = (angleDegrees === 90 || angleDegrees === -90) ? w : h;
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = newW; tempCanvas.height = newH;
        tempCtx.translate(newW / 2, newH / 2);
        tempCtx.rotate(angleDegrees * Math.PI / 180);
        tempCtx.drawImage(canvas, -w / 2, -h / 2);
        canvas.width = newW; canvas.height = newH;
        ctx.clearRect(0, 0, newW, newH);
        ctx.drawImage(tempCanvas, 0, 0);
        currentBounds = { left: 0, top: 0, right: newW, bottom: newH, width: newW, height: newH };
        calculateAndUpdatePrice();
        drawBoundingBox(currentBounds);
        updateThumbnail();
    }
}

function redrawOriginalImageWithFilters() {
    if (!originalImage || !ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
    let imageData;
    if (isGrayscale) {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
        }
        ctx.putImageData(imageData, 0, 0);
    } else if (isSepia) {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
            data[i+1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
            data[i+2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        }
        ctx.putImageData(imageData, 0, 0);
    }
    updateThumbnail();
}

function toggleGrayscaleFilter() {
    if (!canvas || !ctx || !originalImage) return;
    isGrayscale = !isGrayscale; isSepia = false;
    redrawOriginalImageWithFilters();
}

function toggleSepiaFilter() {
    if (!canvas || !ctx || !originalImage) return;
    isSepia = !isSepia; isGrayscale = false;
    redrawOriginalImageWithFilters();
}

function handleDimensionResize(dimension, isMm) {
    if (!pricingConfig || (!originalImage && basePolygons.length === 0) || !dimension) {
        return;
    }
    const selectedResolution = pricingConfig.resolutions.find(r => r.id === stickerResolutionSelect.value);
    if (!selectedResolution) return;

    const ppi = selectedResolution.ppi;
    let targetPixels = dimension * ppi;
    if (isMm) {
        targetPixels = (dimension / 25.4) * ppi;
    }

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
        currentPolygons = basePolygons.map(poly =>
            poly.map(point => ({ x: point.x * scale, y: point.y * scale }))
        );
        redrawAll();
    } else if (originalImage) {
        const newWidth = originalImage.width * scale;
        const newHeight = originalImage.height * scale;
        if (newWidth > 0 && newHeight > 0) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            redrawOriginalImageWithFilters(); // Redraws with filters
            currentBounds = { left: 0, top: 0, right: newWidth, bottom: newHeight, width: newWidth, height: newHeight };
            currentCutline = [[ { x: 0, y: 0 }, { x: newWidth, y: 0 }, { x: newWidth, y: newHeight }, { x: 0, y: newHeight } ]];
            calculateAndUpdatePrice();
            drawBoundingBox(currentBounds);
        }
    }
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
        updateThumbnail();
    };
    imgToCrop.src = currentCanvasDataUrl;
}

// --- Smart Cutline Generation ---
function imageHasTransparentBorder() {
    if (!canvas || !ctx) return false;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;
    const borderSampleSize = 10;
    const isTransparentOrWhite = (i) => {
        if (data[i+3] < 128) return true;
        if (data[i] > 250 && data[i+1] > 250 && data[i+2] > 250) return true;
        return false;
    };
    for (let x = 0; x < width; x += Math.floor(width / borderSampleSize)) {
        if (!isTransparentOrWhite((0 * width + x) * 4) || !isTransparentOrWhite(((height - 1) * width + x) * 4)) return false;
    }
    for (let y = 0; y < height; y += Math.floor(height / borderSampleSize)) {
        if (!isTransparentOrWhite((y * width + 0) * 4) || !isTransparentOrWhite((y * width + (width - 1)) * 4)) return false;
    }
    return true;
}

function handleGenerateCutline() {
    if (!canvas || !ctx || !originalImage) {
        showPaymentStatus('Smart cutline requires a raster image (PNG, JPG). Please upload one.', 'error');
        return;
    }
    if (!imageHasTransparentBorder()) {
        const proceed = confirm("This image does not appear to have a transparent or white background. The 'Smart Cutline' feature may not produce a good result. Proceed anyway?");
        if (!proceed) return;
    }
    showPaymentStatus('Generating smart cutline...', 'info');
    const originalCanvasData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setTimeout(() => {
        try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const contour = traceContour(imageData);
            if (!contour || contour.length < 3) throw new Error("Could not find a distinct contour.");
            const simplifiedContour = simplifyPolygon(contour, 2.0);
            const scale = 100;
            const scaledPoly = simplifiedContour.map(p => ({ X: p.x * scale, Y: p.y * scale }));
            const cleanedScaledPoly = ClipperLib.Clipper.CleanPolygon(scaledPoly, 1.415);
            if (!cleanedScaledPoly || cleanedScaledPoly.length < 3) throw new Error("Could not detect a usable outline.");
            const finalContour = cleanedScaledPoly.map(p => ({ x: p.X / scale, y: p.Y / scale }));
            basePolygons = [finalContour];
            currentPolygons = [finalContour];
            redrawAll();
            showPaymentStatus('Smart cutline generated successfully.', 'success');
        } catch (error) {
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
        return !(data[i+3] < 128 || (data[i] > 250 && data[i+1] > 250 && data[i+2] > 250));
    };
    let startPos = null;
    for (let y = 0; y < height && !startPos; y++) {
        for (let x = 0; x < width; x++) {
            if (isOpaque(x, y)) {
                startPos = { x, y };
                break;
            }
        }
    }
    if (!startPos) return null;

    const contour = [];
    let currentPos = startPos;
    let lastDirection = 6;
    const neighbors = [{x:1,y:0},{x:1,y:-1},{x:0,y:-1},{x:-1,y:-1},{x:-1,y:0},{x:-1,y:1},{x:0,y:1},{x:1,y:1}];
    do {
        contour.push({ x: currentPos.x, y: currentPos.y });
        let checkDirection = (lastDirection + 5) % 8;
        let nextPos = null;
        for (let i = 0; i < 8; i++) {
            const neighborPos = { x: currentPos.x + neighbors[checkDirection].x, y: currentPos.y + neighbors[checkDirection].y };
            if (isOpaque(neighborPos.x, neighborPos.y)) {
                nextPos = neighborPos;
                lastDirection = checkDirection;
                break;
            }
            checkDirection = (checkDirection + 1) % 8;
        }
        if (!nextPos) break;
        currentPos = nextPos;
    } while (currentPos.x !== startPos.x || currentPos.y !== startPos.y);
    return contour;
}

function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    if (dx === 0 && dy === 0) return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
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