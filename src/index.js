import { SVGParser } from './lib/svgparser.js';
import DOMPurify from 'dompurify';

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
let rotateLeftBtnEl, rotateRightBtnEl, resizeInputEl, resizeBtnEl, startCropBtnEl, grayscaleBtnEl, sepiaBtnEl;

let currentOrderAmountCents = 0;

let customerOrder = {
    designImageFile: null,
    designImageURL: null,
    cutFileSVG: null,
};

// --- Main Application Setup ---
async function BootStrap() {
    // Assign DOM elements
    canvas = document.getElementById('imageCanvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    const showOrderCreationBtn = document.getElementById('show-order-creation-btn');
    const orderCreationContainer = document.getElementById('order-creation-container');
    showOrderCreationBtn.addEventListener('click', () => {
        orderCreationContainer.classList.toggle('hidden');
    });

    const designImageInput = document.getElementById('design-image-upload');
    const cutFileInput = document.getElementById('cut-file-upload');
    const cutFilePreview = document.getElementById('cut-file-preview-container');
    const statusDiv = document.getElementById('status');

    designImageInput.addEventListener('change', (e) => handleDesignImageChange(e, cutFilePreview));
    cutFileInput.addEventListener('change', (e) => handleCutFileChange(e, cutFilePreview, statusDiv));

    const submitOrderBtn = document.getElementById('submit-order-btn');
    submitOrderBtn.addEventListener('click', handleSubmitOrder);

    // All the other original bootstrap logic remains here...
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
    ipfsLinkContainer = document.getElementById('ipfsLinkContainer');
    fileInputGlobalRef = document.getElementById('file');
    fileNameDisplayEl = document.getElementById('fileNameDisplay');
    paymentFormGlobalRef = document.getElementById('payment-form');
    rotateLeftBtnEl = document.getElementById('rotateLeftBtn');
    rotateRightBtnEl = document.getElementById('rotateRightBtn');
    const resizeSliderEl = document.getElementById('resizeSlider');
    const resizeValueEl = document.getElementById('resizeValue');
    startCropBtnEl = document.getElementById('startCropBtn');
    grayscaleBtnEl = document.getElementById('grayscaleBtn');
    sepiaBtnEl = document.getElementById('sepiaBtn');
    const generateCutlineBtn = document.getElementById('generateCutlineBtn');

    await Promise.all([
        fetchCsrfToken(),
        fetchPricingInfo()
    ]);

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
            const percentage = parseInt(e.target.value, 10);
            if(resizeValueEl) resizeValueEl.textContent = `${percentage}%`;
            handleResize(percentage);
        });
    }
    if (startCropBtnEl) startCropBtnEl.addEventListener('click', handleCrop);
    if(generateCutlineBtn) generateCutlineBtn.addEventListener('click', handleGenerateCutline);

    const standardSizesContainer = document.getElementById('standard-sizes-controls');
    if (standardSizesContainer) {
        standardSizesContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('size-btn')) {
                const targetInches = parseFloat(e.target.dataset.size);
                handleStandardResize(targetInches);
            }
        });
    }

    const unitToggle = document.getElementById('unitToggle');
    if (unitToggle) {
        unitToggle.addEventListener('change', (e) => {
            isMetric = e.target.checked;
            calculateAndUpdatePrice();
            redrawAll();
        });
    }

    if (fileInputGlobalRef) {
        fileInputGlobalRef.addEventListener('change', handleFileChange);
    }

    const previewArea = document.getElementById('preview-area');
    previewArea.addEventListener('click', () => {
        document.getElementById('editor-modal').classList.remove('hidden');
    });

    const okEditBtn = document.getElementById('ok-edit-btn');
    okEditBtn.addEventListener('click', () => {
        document.getElementById('editor-modal').classList.add('hidden');
    });

    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    cancelEditBtn.addEventListener('click', () => {
        document.getElementById('editor-modal').classList.add('hidden');
    });

    if (paymentFormGlobalRef) {
        paymentFormGlobalRef.addEventListener('submit', handlePaymentFormSubmit);
    } else {
        console.error("[CLIENT] BootStrap: Payment form with ID 'payment-form' not found. Payments will not work.");
        showPaymentStatus("Payment form is missing. Cannot process payments.", "error");
    }

    updateEditingButtonsState(!originalImage);
}

function handleDesignImageChange(event, cutFilePreview) {
    const file = event.target.files[0];
    if (!file) return;

    customerOrder.designImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        customerOrder.designImageURL = e.target.result;
        const img = new Image();
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            document.getElementById('get-started-prompt').style.display = 'none';
            updateCustomerStatus('Design image loaded.', 'success');
            if (!customerOrder.cutFileSVG) {
                generateDefaultCutline(customerOrder.designImageURL, cutFilePreview);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handleCutFileChange(event, cutFilePreview, statusDiv) {
    const file = event.target.files[0];
    if (!file || file.type !== 'image/svg+xml') {
        updateCustomerStatus('Please upload a valid SVG file for the cutline.', 'error', statusDiv);
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        customerOrder.cutFileSVG = e.target.result;
        cutFilePreview.innerHTML = DOMPurify.sanitize(customerOrder.cutFileSVG);
        cutFilePreview.style.display = 'block';
        updateCustomerStatus('Custom cut file loaded.', 'success', statusDiv);
    };
    reader.readAsText(file);
}

function generateDefaultCutline(imageSrc, cutFilePreview) {
    updateCustomerStatus('Generating default cutline...', 'info');
    const img = new Image();
    img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const rect = document.createElementNS(svgNS, "rect");
        const offset = 10;
        rect.setAttribute('x', offset);
        rect.setAttribute('y', offset);
        rect.setAttribute('width', width - (offset * 2));
        rect.setAttribute('height', height - (offset * 2));
        rect.setAttribute('stroke', 'magenta');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('fill', 'none');
        svg.appendChild(rect);

        customerOrder.cutFileSVG = svg.outerHTML;
        cutFilePreview.innerHTML = DOMPurify.sanitize(customerOrder.cutFileSVG);
        updateCustomerStatus('Default cutline generated.', 'success');
    };
    img.src = imageSrc;
}

function updateCustomerStatus(message, type = 'info', statusDiv) {
    if (!statusDiv) {
        statusDiv = document.getElementById('payment-status-container');
    }
    statusDiv.textContent = message;
    statusDiv.className = `mb-4 p-3 rounded-md text-sm text-white status ${type}`;
    statusDiv.style.visibility = 'visible';
}

document.addEventListener('DOMContentLoaded', BootStrap);

// All other functions from the original index.js are preserved below
// (handlePaymentFormSubmit, pricing logic, etc.)
// ...
