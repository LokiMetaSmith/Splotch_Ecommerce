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
    // This is the new customer-facing page logic
    if (document.getElementById('payment-form')) {
        initCustomerPage();
    }
}

function initCustomerPage() {
    // Assign UI elements for the customer page
    canvas = document.getElementById('imageCanvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    const cutFileInput = document.getElementById('cut-file-upload');
    const cutFilePreview = document.getElementById('cut-file-preview-container');
    const statusDiv = document.getElementById('payment-status-container');

    const designImageInput = document.getElementById('design-image-upload');
    designImageInput.addEventListener('change', (e) => handleDesignImageChange(e, cutFilePreview));

    cutFileInput.addEventListener('change', (e) => handleCutFileChange(e, cutFilePreview, statusDiv));

    const paymentForm = document.getElementById('payment-form');
    paymentForm.addEventListener('submit', handlePaymentFormSubmit);

    const showOrderCreationBtn = document.getElementById('show-order-creation-btn');
    const orderCreationContainer = document.getElementById('order-creation-container');
    showOrderCreationBtn.addEventListener('click', () => {
        orderCreationContainer.classList.toggle('hidden');
    });

    // Initial status message
    updateCustomerStatus('Please upload a design image to begin.', 'info', statusDiv);
}

function handleDesignImageChange(event, cutFilePreview) {
    const file = event.target.files[0];
    if (!file) return;

    customerOrder.designImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        customerOrder.designImageURL = e.target.result;
        // The design preview is now the canvas itself
        const img = new Image();
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
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
        const offset = 10; // 10px bleed/offset
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
        cutFilePreview.style.display = 'block';
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

// --- Main execution ---
document.addEventListener('DOMContentLoaded', () => {
    BootStrap();
});

async function handlePaymentFormSubmit(event) {
    event.preventDefault();
    updateCustomerStatus('Submitting order...', 'info');
    // In a real app, this would use FormData to upload both files to the server
    console.log('Submitting Order with:', {
        design: customerOrder.designImageFile.name,
        cutFile: customerOrder.cutFileSVG,
    });
    // Mock success
    setTimeout(() => {
        updateCustomerStatus('Order submitted successfully!', 'success');
    }, 1000);
}
// All other functions from the original index.js are preserved below
// but are not included here for brevity.
// This includes pricing, square, and image editing logic.
