import { SVGParser } from "./lib/svgparser.js";
import { calculateStickerPrice, calculatePerimeter } from "./lib/pricing.js";
import {
  drawRuler as drawCanvasRuler,
  drawImageWithFilters,
} from "./lib/canvas-utils.js";
import {
  traceContours,
  getPolygonArea,
  simplifyPolygon,
  smoothPolygon,
  imageHasTransparentBorder,
  filterInternalContours,
} from "./lib/image-processing.js";

// index.js

const appId = "sandbox-sq0idb-tawTw_Vl7VGYI6CZfKEshA";
const locationId = "LTS82DEX24XR0";
const serverUrl = "http://localhost:3000"; // Define server URL once

// Declare globals for SDK objects and key DOM elements
let payments, card, csrfToken;
let originalImage = null;
let canvas, ctx;

// Globals for SVG processing state
let basePolygons = []; // The original, unscaled polygons from the SVG
let currentPolygons = [];
let rasterCutlinePoly = null; // New global for Raster Mode cutline
let cleanCanvasState = null; // To store clean image state (pixels + filters + rotation)
let isMetric = false; // To track unit preference
let currentCutline = [];
let currentBounds = null;
let pricingConfig = null;
let inventoryCache = {}; // Cache for Odoo inventory
let isGrayscale = false;
let isSepia = false;

let textInput,
  textSizeInput,
  textSizeSlider,
  textColorInput,
  addTextBtn,
  textFontFamilySelect,
  textEditingControlsContainer,
  cutlineOffsetSlider,
  cutlineOffsetValueDisplay,
  cutlineSensitivitySlider,
  cutlineSensitivityValueDisplay;
let cutlineSensitivity = 10; // Default sensitivity
let stickerMaterialSelect,
  stickerResolutionSelect,
  designMarginNote,
  stickerQuantityInput,
  calculatedPriceDisplay;
let paymentStatusContainer,
  ipfsLinkContainer,
  fileInputGlobalRef,
  paymentFormGlobalRef,
  fileNameDisplayEl;
let rotateLeftBtnEl,
  rotateRightBtnEl,
  resetBtnEl,
  resizeInputEl,
  resizeBtnEl,
  grayscaleBtnEl,
  sepiaBtnEl;
let submitPaymentBtn;
let widthDisplayEl, heightDisplayEl;
let canvasPlaceholder;

let currentOrderAmountCents = 0;
let currentProductId = null; // Track if we are in "Product Mode"
let creatorProfitCents = 0; // The markup for the current product
let cutlineOffset = 10; // Default offset

// Memoization globals for pricing
let lastCalculatedPerimeter = 0;
let lastCalculatedPerimeterCutlineRef = null;

function getPolygonsBounds(polygons) {
  if (!polygons || polygons.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  polygons.forEach((poly) => {
    poly.forEach((pt) => {
      // Handle both case styles safely
      const x = pt.x !== undefined ? pt.x : pt.X;
      const y = pt.y !== undefined ? pt.y : pt.Y;

      if (x !== undefined && y !== undefined) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    });
  });

  if (minX === Infinity) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  return {
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// --- Main Application Setup ---
async function BootStrap() {
  // Assign DOM elements
  canvas = document.getElementById("imageCanvas");
  if (!canvas) {
    console.error("FATAL: imageCanvas element not found. Aborting BootStrap.");
    const body = document.querySelector("body");
    if (body) {
      const errorDiv = document.createElement("div");
      errorDiv.textContent =
        "Critical error: Image canvas not found. Please refresh or contact support.";
      errorDiv.style.color = "red";
      errorDiv.style.padding = "20px";
      errorDiv.style.textAlign = "center";
      body.prepend(errorDiv);
    }
    return;
  }
  ctx = canvas.getContext("2d", { willReadFrequently: true });

  const initialWidth = canvas.width;
  const initialHeight = canvas.height;
  canvas.style.width = `${initialWidth}px`;
  canvas.style.height = `${initialHeight}px`;
  setCanvasSize(initialWidth, initialHeight);

  textInput = document.getElementById("textInput");
  textSizeInput = document.getElementById("textSizeInput");
  textSizeSlider = document.getElementById("textSizeSlider");
  textColorInput = document.getElementById("textColorInput");
  addTextBtn = document.getElementById("addTextBtn");
  textFontFamilySelect = document.getElementById("textFontFamily");
  textEditingControlsContainer = document.getElementById(
    "text-editing-controls",
  );
  stickerMaterialSelect = document.getElementById("stickerMaterial");
  stickerResolutionSelect = document.getElementById("stickerResolution");
  designMarginNote = document.getElementById("designMarginNote");
  stickerQuantityInput = document.getElementById("stickerQuantity");
  calculatedPriceDisplay = document.getElementById("calculatedPriceDisplay");
  paymentStatusContainer = document.getElementById("payment-status-container");
  ipfsLinkContainer = document.getElementById("ipfsLinkContainer"); // This might be deprecated if IPFS is handled server-side
  fileInputGlobalRef = document.getElementById("file");
  fileNameDisplayEl = document.getElementById("fileNameDisplay");
  paymentFormGlobalRef = document.getElementById("payment-form");
  submitPaymentBtn = document.getElementById("submitPaymentBtn");
  canvasPlaceholder = document.getElementById("canvas-placeholder");

  widthDisplayEl = document.getElementById("widthDisplay");
  heightDisplayEl = document.getElementById("heightDisplay");

  rotateLeftBtnEl = document.getElementById("rotateLeftBtn");
  rotateRightBtnEl = document.getElementById("rotateRightBtn");
  resetBtnEl = document.getElementById("resetBtn");
  const resizeSliderEl = document.getElementById("resizeSlider");
  const resizeInputNumberEl = document.getElementById("resizeInput");
  const resizeUnitLabelEl = document.getElementById("resizeUnitLabel");
  grayscaleBtnEl = document.getElementById("grayscaleBtn");
  sepiaBtnEl = document.getElementById("sepiaBtn");
  cutlineOffsetSlider = document.getElementById("cutlineOffsetSlider");
  cutlineOffsetValueDisplay = document.getElementById("cutlineOffsetValue");
  cutlineSensitivitySlider = document.getElementById("cutlineSensitivitySlider");
  cutlineSensitivityValueDisplay = document.getElementById("cutlineSensitivityValue");

  // Fetch CSRF token and pricing info
  await Promise.all([fetchCsrfToken(), fetchPricingInfo(), fetchInventory()]);

  // Initialize Square Payments SDK
  console.log(
    `[CLIENT] Initializing Square SDK with appId: ${appId}, locationId: ${locationId}`,
  );
  try {
    if (!window.Square || !window.Square.payments) {
      throw new Error("Square SDK is not loaded.");
    }
    payments = window.Square.payments(appId, locationId);
    card = await initializeCard(payments);
  } catch (error) {
    let msg = `Failed to initialize payments: ${error.message}`;
    if (error.message.includes("Network") || typeof Square === "undefined") {
      msg += " (Check your AdBlocker)";
      showAdBlockerWarning();
    }
    showPaymentStatus(msg, "error");
    console.error("[CLIENT] Failed to initialize Square payments SDK:", error);
    return;
  }

  // Attach event listeners
  if (stickerQuantityInput) {
    calculateAndUpdatePrice();
    stickerQuantityInput.addEventListener("input", calculateAndUpdatePrice);
    stickerQuantityInput.addEventListener("change", calculateAndUpdatePrice);

    const decreaseQuantityBtn = document.getElementById("decreaseQuantityBtn");
    const increaseQuantityBtn = document.getElementById("increaseQuantityBtn");

    if (decreaseQuantityBtn) {
      decreaseQuantityBtn.addEventListener("click", () => {
        let currentVal = parseInt(stickerQuantityInput.value) || 0;
        if (currentVal > 1) {
          stickerQuantityInput.value = currentVal - 1;
          stickerQuantityInput.dispatchEvent(new Event("input"));
          stickerQuantityInput.dispatchEvent(new Event("change"));
        }
      });
    }

    if (increaseQuantityBtn) {
      increaseQuantityBtn.addEventListener("click", () => {
        let currentVal = parseInt(stickerQuantityInput.value) || 0;
        stickerQuantityInput.value = currentVal + 1;
        stickerQuantityInput.dispatchEvent(new Event("input"));
        stickerQuantityInput.dispatchEvent(new Event("change"));
      });
    }
  }
  if (stickerMaterialSelect) {
    stickerMaterialSelect.addEventListener("change", calculateAndUpdatePrice);
  }
  if (stickerResolutionSelect) {
    stickerResolutionSelect.addEventListener("change", calculateAndUpdatePrice);
  }
  if (addTextBtn) {
    addTextBtn.addEventListener("click", handleAddText);
  }

  // Sync text size slider and input
  if (textSizeSlider && textSizeInput) {
    textSizeSlider.addEventListener("input", (e) => {
      textSizeInput.value = e.target.value;
    });
    textSizeInput.addEventListener("input", (e) => {
      textSizeSlider.value = e.target.value;
    });
  }
  if (rotateLeftBtnEl)
    rotateLeftBtnEl.addEventListener("click", () =>
      rotateCanvasContentFixedBounds(-90),
    );
  if (rotateRightBtnEl)
    rotateRightBtnEl.addEventListener("click", () =>
      rotateCanvasContentFixedBounds(90),
    );
  if (resetBtnEl) resetBtnEl.addEventListener("click", handleResetImage);
  if (grayscaleBtnEl)
    grayscaleBtnEl.addEventListener("click", toggleGrayscaleFilter);
  if (sepiaBtnEl) sepiaBtnEl.addEventListener("click", toggleSepiaFilter);
  if (resizeSliderEl) {
    let resizeRequest = null;
    // Slider updates Input
    resizeSliderEl.addEventListener("input", (e) => {
      let value = parseFloat(e.target.value);
      if (resizeInputNumberEl) resizeInputNumberEl.value = value.toFixed(1);

      // Update unit label just in case
      if (resizeUnitLabelEl)
        resizeUnitLabelEl.textContent = isMetric ? "mm" : "in";

      if (resizeInputNumberEl)
        resizeSliderEl.setAttribute(
          "aria-valuetext",
          `${resizeInputNumberEl.value} ${isMetric ? "mm" : "in"}`,
        );

      if (!resizeRequest) {
        resizeRequest = requestAnimationFrame(() => {
          // Always read the latest value from the input element to avoid using stale closure variables
          const latestValue = parseFloat(resizeSliderEl.value);
          if (isMetric) {
            handleStandardResize(latestValue / 25.4);
          } else {
            handleStandardResize(latestValue);
          }
          resizeRequest = null;
        });
      }
    });
  }

  // Input updates Slider
  if (resizeInputNumberEl) {
    resizeInputNumberEl.addEventListener("change", (e) => {
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val <= 0) return;

      if (resizeSliderEl) {
        resizeSliderEl.value = val;
        // Trigger slider input event to run resize logic
        resizeSliderEl.dispatchEvent(new Event("input"));
      }
    });
  }
  const generateCutlineBtn = document.getElementById("generateCutlineBtn");
  if (generateCutlineBtn)
    generateCutlineBtn.addEventListener("click", handleGenerateCutline);

  if (cutlineOffsetSlider) {
    let pendingCutlineUpdate = false;
    cutlineOffsetSlider.addEventListener("input", (e) => {
      cutlineOffset = parseInt(e.target.value, 10);
      if (cutlineOffsetValueDisplay)
        cutlineOffsetValueDisplay.textContent = cutlineOffset;

      if (!pendingCutlineUpdate) {
        pendingCutlineUpdate = true;
        requestAnimationFrame(() => {
          if (rasterCutlinePoly) {
            // Re-generate cutline for raster (Overlay Mode)
            const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
            currentCutline = cutline;
            currentBounds = getPolygonsBounds(cutline);
            calculateAndUpdatePrice();
            drawCanvasDecorations(currentBounds);
          } else if (basePolygons.length > 0) {
            // Re-generate for SVG (Vector Mode)
            redrawAll();
          }
          pendingCutlineUpdate = false;
        });
      }
    });
  }

  if (cutlineSensitivitySlider) {
    // Update value display immediately
    cutlineSensitivitySlider.addEventListener("input", (e) => {
        cutlineSensitivity = parseInt(e.target.value, 10);
        if (cutlineSensitivityValueDisplay) {
            cutlineSensitivityValueDisplay.textContent = cutlineSensitivity;
        }
    });

    // Trigger regeneration only on change (mouse up) to avoid lag
    cutlineSensitivitySlider.addEventListener("change", () => {
        if (originalImage && rasterCutlinePoly) {
            handleGenerateCutline();
        }
    });
  }

  // Creator / Product UI
  const sellDesignBtn = document.getElementById("sellDesignBtn");
  const productModal = document.getElementById("productModal");
  const cancelProductBtn = document.getElementById("cancelProductBtn");
  const createProductBtn = document.getElementById("createProductBtn");
  const copyLinkBtn = document.getElementById("copyLinkBtn");

  let lastFocusedElement;
  if (sellDesignBtn) {
    sellDesignBtn.addEventListener("click", () => {
      if (!originalImage || !currentCutline || currentCutline.length === 0) {
        showPaymentStatus(
          "Please upload an image and generate a cutline first.",
          "error",
        );
        return;
      }
      lastFocusedElement = document.activeElement;
      productModal.classList.remove("hidden");
      document.getElementById("productLinkContainer").classList.add("hidden");
      document.getElementById("productName")?.focus();
    });
  }
  const closeProductModal = () => {
    productModal.classList.add("hidden");
    if (lastFocusedElement) lastFocusedElement.focus();
  };
  if (cancelProductBtn) {
    cancelProductBtn.addEventListener("click", closeProductModal);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !productModal.classList.contains("hidden")) {
      closeProductModal();
    }
  });
  if (createProductBtn) {
    createProductBtn.addEventListener("click", handleCreateProduct);
  }
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener("click", () => {
      const linkInput = document.getElementById("productLinkInput");
      linkInput.select();
      document.execCommand("copy"); // Fallback/Legacy
      navigator.clipboard.writeText(linkInput.value);
      copyLinkBtn.textContent = "Copied!";
      setTimeout(() => (copyLinkBtn.textContent = "Copy"), 2000);
    });
  }

  // Check for authentication to show "Sell" button
  checkAuthStatus();

  // Check for product mode (Buyer Flow)
  const urlParams = new URLSearchParams(window.location.search);
  const productIdParam = urlParams.get("product_id");
  const designParam = urlParams.get("design");
  if (productIdParam) {
    await loadProductForBuyer(productIdParam);
  } else if (designParam) {
    // REORDER FLOW: Load the image, but allow editing
    await handleRemoteImageLoad(designParam);
  }

  const standardSizesContainer = document.getElementById(
    "standard-sizes-controls",
  );
  if (standardSizesContainer) {
    standardSizesContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".size-btn");
      if (btn) {
        const targetInches = parseFloat(btn.dataset.size);
        handleStandardResize(targetInches);

        // Also update the slider
        const resizeSliderEl = document.getElementById("resizeSlider");
        const resizeInputNumberEl = document.getElementById("resizeInput");
        if (resizeSliderEl && resizeInputNumberEl) {
          if (isMetric) {
            resizeSliderEl.value = targetInches * 25.4;
            resizeInputNumberEl.value = (targetInches * 25.4).toFixed(1);
          } else {
            resizeSliderEl.value = targetInches;
            resizeInputNumberEl.value = targetInches.toFixed(1);
          }
          resizeSliderEl.setAttribute(
            "aria-valuetext",
            `${resizeInputNumberEl.value} ${isMetric ? "mm" : "in"}`,
          );
        }
      }
    });
  }

  const unitToggle = document.getElementById("unitToggle");
  if (unitToggle) {
    unitToggle.addEventListener("change", (e) => {
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
    fileInputGlobalRef.addEventListener("change", handleFileChange);
  }

  // Add drag-and-drop and paste listeners to the canvas
  if (canvas) {
    canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      canvas.classList.add("border-dashed", "border-2", "border-blue-500");
    });

    canvas.addEventListener("dragleave", (e) => {
      e.preventDefault();
      canvas.classList.remove("border-dashed", "border-2", "border-blue-500");
    });

    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      canvas.classList.remove("border-dashed", "border-2", "border-blue-500");

      // Handle Mascot Drop
      if (e.dataTransfer.getData('application/x-mascot-drag')) {
        const mascotSrc = e.dataTransfer.getData('text/uri-list');
        if (mascotSrc) {
            fetch(mascotSrc)
                .then(res => res.blob())
                .then(blob => {
                    const file = new File([blob], "Splotch-Mascot.png", { type: blob.type });
                    loadFileAsImage(file);
                })
                .catch(err => console.error("Failed to load mascot", err));
        }
        return;
      }

      const file = e.dataTransfer.files[0];
      if (file) {
        loadFileAsImage(file);
      }
    });
  }

  // Add interaction listeners to the placeholder
  if (canvasPlaceholder) {
    const activeClasses = [
      "bg-blue-50",
      "bg-opacity-90",
      "border-2",
      "border-dashed",
      "border-splotch-teal",
      "scale-105",
      "shadow-lg",
    ];

    // Drag and drop mirroring
    canvasPlaceholder.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (canvas)
        canvas.classList.add("border-dashed", "border-2", "border-blue-500");
      canvasPlaceholder.classList.add(...activeClasses);
    });

    canvasPlaceholder.addEventListener("dragleave", (e) => {
      e.preventDefault();
      if (canvas)
        canvas.classList.remove("border-dashed", "border-2", "border-blue-500");
      canvasPlaceholder.classList.remove(...activeClasses);
    });

    canvasPlaceholder.addEventListener("drop", (e) => {
      e.preventDefault();
      if (canvas)
        canvas.classList.remove("border-dashed", "border-2", "border-blue-500");
      canvasPlaceholder.classList.remove(...activeClasses);

      // Handle Mascot Drop
      if (e.dataTransfer.getData('application/x-mascot-drag')) {
        const mascotSrc = e.dataTransfer.getData('text/uri-list');
        if (mascotSrc) {
            fetch(mascotSrc)
                .then(res => res.blob())
                .then(blob => {
                    const file = new File([blob], "Splotch-Mascot.png", { type: blob.type });
                    loadFileAsImage(file);
                })
                .catch(err => console.error("Failed to load mascot", err));
        }
        return;
      }

      const file = e.dataTransfer.files[0];
      if (file) {
        loadFileAsImage(file);
      }
    });

    // Click to upload
    canvasPlaceholder.addEventListener("click", () => {
      if (fileInputGlobalRef) fileInputGlobalRef.click();
    });

    // Keyboard accessibility
    canvasPlaceholder.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (fileInputGlobalRef) fileInputGlobalRef.click();
      }
    });
  }

  window.addEventListener("paste", (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let hasFile = false;
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          loadFileAsImage(file);
          hasFile = true;
        }
      }
    }

    if (hasFile) {
      e.preventDefault();
      return;
    }

    // Check if targeting canvas container
    const container = document.getElementById("canvas-container");
    if (container && (e.target === container || container.contains(e.target))) {
      // If pasting text into canvas container, block it
      e.preventDefault();
    }
  });

  // Block keys in canvas container to prevent text input
  const container = document.getElementById("canvas-container");
  if (container) {
    container.addEventListener("keydown", (e) => {
      // Allow shortcuts like Ctrl+C, Ctrl+V, Ctrl+X
      if (e.ctrlKey || e.metaKey) return;

      // Allow navigation arrows, Tab, Delete, and Backspace
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Tab",
          "Delete",
          "Backspace",
        ].includes(e.key)
      )
        return;

      e.preventDefault();
    });
  }

  // Set up the payment form
  console.log(
    "[CLIENT] BootStrap: Checking paymentFormGlobalRef before attaching listener. paymentFormGlobalRef:",
    paymentFormGlobalRef,
  );
  if (paymentFormGlobalRef) {
    console.log(
      "[CLIENT] BootStrap: paymentFormGlobalRef found. Attaching submit event listener.",
    );
    paymentFormGlobalRef.addEventListener("submit", handlePaymentFormSubmit);
  } else {
    console.error(
      "[CLIENT] BootStrap: Payment form with ID 'payment-form' not found. Payments will not work.",
    );
    showPaymentStatus(
      "Payment form is missing. Cannot process payments.",
      "error",
    );
  }

  // Initial UI state
  if (!productIdParam) {
    updateEditingButtonsState(!originalImage);
  }
  if (designMarginNote) designMarginNote.style.display = "none";
}

// --- Main execution ---
document.addEventListener("DOMContentLoaded", () => {
  BootStrap();
  // Check if the Square SDK was blocked after 2 seconds
  setTimeout(() => {
    if (typeof Square === "undefined") {
      console.error("[CLIENT] Square SDK appears to be blocked.");
      // Function to show a warning message to the user
      showAdBlockerWarning();
    }
  }, 2000);
});

function showAdBlockerWarning() {
  // For example, make a hidden div visible
  const warningBanner = document.getElementById("adblock-warning");
  if (warningBanner) {
    warningBanner.style.display = "block";
  }
}

function calculateAndUpdatePrice() {
  if (
    !pricingConfig ||
    !stickerQuantityInput ||
    !calculatedPriceDisplay ||
    !stickerResolutionSelect
  ) {
    return;
  }

  const selectedMaterial = stickerMaterialSelect.value;
  checkInventoryStatus(selectedMaterial);

  const selectedResolutionId = stickerResolutionSelect.value;
  const selectedResolution = pricingConfig.resolutions.find(
    (r) => r.id === selectedResolutionId,
  );

  const quantity = parseInt(stickerQuantityInput.value, 10);

  // Update Quantity Button State
  const decreaseQuantityBtn = document.getElementById("decreaseQuantityBtn");
  if (decreaseQuantityBtn) {
    decreaseQuantityBtn.disabled = isNaN(quantity) || quantity <= 1;
  }

  const bounds = currentBounds;
  const cutline = currentCutline;

  if (isNaN(quantity) || quantity < 0) {
    currentOrderAmountCents = 0;
    calculatedPriceDisplay.textContent =
      quantity < 0 ? "Invalid Quantity" : formatPrice(0);
    return;
  }

  if (!bounds || !cutline || !selectedResolution) {
    currentOrderAmountCents = 0;
    calculatedPriceDisplay.innerHTML = `Price: <span class="text-gray-500">---</span>`;
    if (widthDisplayEl) widthDisplayEl.textContent = "---";
    if (heightDisplayEl) heightDisplayEl.textContent = "---";
    return;
  }

  // Bolt Optimization: Memoize the perimeter calculation to avoid O(N) loop on every input event (like typing quantity)
  if (cutline && cutline !== lastCalculatedPerimeterCutlineRef) {
    lastCalculatedPerimeter = calculatePerimeter(cutline);
    lastCalculatedPerimeterCutlineRef = cutline;
  }

  const priceResult = calculateStickerPrice(
    pricingConfig,
    quantity,
    selectedMaterial,
    bounds,
    cutline,
    selectedResolution,
    lastCalculatedPerimeter,
  );

  // --- Creator Markup Logic ---
  const totalMarkup = creatorProfitCents * quantity;
  currentOrderAmountCents = priceResult.total + totalMarkup;
  // ----------------------------

  const ppi = selectedResolution.ppi;
  let width = bounds.width / ppi;
  let height = bounds.height / ppi;
  let unit = "in";

  if (isMetric) {
    width *= 25.4;
    height *= 25.4;
    unit = "mm";
  }

  if (widthDisplayEl)
    widthDisplayEl.textContent = `${width.toFixed(2)} ${unit}`;
  if (heightDisplayEl)
    heightDisplayEl.textContent = `${height.toFixed(2)} ${unit}`;

  let markupHtml = "";
  if (creatorProfitCents > 0) {
    markupHtml = `<span class="text-xs text-green-600 block">Includes Creator Support: ${formatPrice(totalMarkup)}</span>`;
  }

  const unitPriceCents = quantity > 0 ? currentOrderAmountCents / quantity : 0;
  const unitPriceDisplay =
    quantity > 1 && unitPriceCents > 0
      ? `<span class="text-sm text-gray-500 font-medium ml-2">(${formatPrice(unitPriceCents)} each)</span>`
      : "";

  calculatedPriceDisplay.innerHTML = `
        <div class="flex items-baseline">
            <span class="font-bold text-lg">${formatPrice(currentOrderAmountCents)}</span>
            ${unitPriceDisplay}
        </div>
        ${markupHtml}
        <span class="text-sm text-gray-600 block mt-1">
            Size: ${width.toFixed(1)}${unit} x ${height.toFixed(1)}${unit}
        </span>
        <span class="text-xs text-gray-500 block">
            Complexity Modifier: x${priceResult.complexityMultiplier}
        </span>
    `;
}

function formatPrice(amountInCents) {
  const amountInDollars = amountInCents / 100;
  return amountInDollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// --- Square SDK Functions ---
async function initializeCard(paymentsSDK) {
  if (!paymentsSDK)
    throw new Error("Payments SDK not ready for card initialization.");
  const cardInstance = await paymentsSDK.card();
  await cardInstance.attach("#card-container");
  return cardInstance;
}

async function tokenize(paymentMethod, verificationDetails) {
  if (!paymentMethod) throw new Error("Card payment method not initialized.");

  // In dev mode (insecure context), verificationDetails can cause strict validation errors
  // or SCA failures. We skip passing them if the context is insecure.
  let tokenizationArgs = verificationDetails;
  if (verificationDetails && typeof window !== 'undefined' && !window.isSecureContext) {
    console.warn(
      "Insecure context detected: Skipping verificationDetails for tokenization.",
    );
    tokenizationArgs = undefined;
  }

  const tokenResult = await paymentMethod.tokenize(tokenizationArgs);
  if (tokenResult.status === "OK") {
    if (!tokenResult.token)
      throw new Error("Tokenization succeeded but no token was returned.");
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
  stickerResolutionSelect.innerHTML = ""; // Clear existing options
  pricingConfig.resolutions.forEach((res) => {
    const option = document.createElement("option");
    option.value = res.id;
    option.textContent = res.name;
    stickerResolutionSelect.appendChild(option);
  });
  // Set a default selection
  stickerResolutionSelect.value = "dpi_300";
}

async function fetchPricingInfo() {
  try {
    const response = await fetch(`${serverUrl}/api/pricing-info`);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    pricingConfig = await response.json();
    console.log("[CLIENT] Pricing config loaded:", pricingConfig);
    // Once config is loaded, populate the dropdown
    populateResolutionDropdown();
  } catch (error) {
    console.error("[CLIENT] Error fetching pricing info:", error);
    showPaymentStatus(
      "Could not load pricing information. Please refresh.",
      "error",
    );
  }
}

async function fetchInventory() {
    try {
        const response = await fetch(`${serverUrl}/api/inventory`);
        if (response.ok) {
            inventoryCache = await response.json();
            console.log('[CLIENT] Inventory loaded:', inventoryCache);
        }
    } catch (error) {
        console.error('[CLIENT] Failed to load inventory:', error);
    }
}

function checkInventoryStatus(materialId) {
    if (!stickerMaterialSelect) return;

    let warningEl = document.getElementById('material-warning');
    if (!warningEl) {
        warningEl = document.createElement('p');
        warningEl.id = 'material-warning';
        warningEl.className = 'text-xs text-red-600 font-bold mt-1';
        stickerMaterialSelect.parentNode.appendChild(warningEl);
    }

    const qty = inventoryCache[materialId];

    // Check if quantity is 0 or less (if tracked)
    if (typeof qty === 'number' && qty <= 0) {
        warningEl.textContent = '⚠️ Low Stock / Out of Stock - Order may be delayed.';
        warningEl.style.display = 'block';
    } else {
        warningEl.style.display = 'none';
    }
}

async function fetchCsrfToken() {
  try {
    const response = await fetch(`${serverUrl}/api/csrf-token`, {
      credentials: "include", // Important for cookies
    });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const data = await response.json();
    if (!data.csrfToken) {
      throw new Error("CSRF token not found in server response");
    }
    csrfToken = data.csrfToken;
    console.log("[CLIENT] CSRF Token fetched and stored.");
  } catch (error) {
    console.error("[CLIENT] Error fetching CSRF token:", error);
    showPaymentStatus(
      "A security token could not be loaded. Please refresh the page to continue.",
      "error",
    );
  }
}

// --- Form Submission Logic ---
async function handlePaymentFormSubmit(event) {
  console.log("[CLIENT] handlePaymentFormSubmit triggered.");
  event.preventDefault();

  let originalBtnContent = "";
  if (submitPaymentBtn) {
    originalBtnContent = submitPaymentBtn.innerHTML;
    submitPaymentBtn.disabled = true;
    submitPaymentBtn.innerHTML = `
            <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Processing...</span>
        `;
  }

  showPaymentStatus("Processing order...", "info");

  // Ensure there is an image to submit
  if (!originalImage) {
    showPaymentStatus(
      "Please upload a sticker design image before submitting.",
      "error",
    );
    if (submitPaymentBtn) {
      submitPaymentBtn.disabled = false;
      submitPaymentBtn.innerHTML = originalBtnContent;
    }
    return;
  }

  // Ensure CSRF token is available
  if (!csrfToken) {
    showPaymentStatus(
      "Cannot submit form. A required security token is missing. Please refresh the page.",
      "error",
    );
    console.error("[CLIENT] Aborting submission: CSRF token is missing.");
    if (submitPaymentBtn) {
      submitPaymentBtn.disabled = false;
      submitPaymentBtn.innerHTML = originalBtnContent;
    }
    return;
  }

  const email = document.getElementById("email").value;
  if (!email) {
    showPaymentStatus("Please enter an email address to proceed.", "error");
    if (submitPaymentBtn) {
      submitPaymentBtn.disabled = false;
      submitPaymentBtn.innerHTML = originalBtnContent;
    }
    return;
  }

  try {
    // 0. Get temporary auth token
    showPaymentStatus("Issuing temporary auth token...", "info");
    const authResponse = await fetch(`${serverUrl}/api/auth/issue-temp-token`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, _csrf: csrfToken }),
    });

    if (!authResponse.ok) {
      const errorData = await authResponse.json().catch(() => ({})); // Catch JSON parsing errors
      if (errorData.error && errorData.error.includes("csrf")) {
        console.warn(
          "[CLIENT] CSRF token was invalid during auth token issuance. Fetching a new one.",
        );
        await fetchCsrfToken(); // Fetch a new token
        showPaymentStatus(
          "Your session expired. It has been refreshed. Please try submitting again.",
          "error",
        );
        return; // Stop the submission process
      }
      throw new Error(
        `Could not issue a temporary authentication token. Server responded with: ${errorData.error || authResponse.statusText}`,
      );
    }
    const { token: tempAuthToken } = await authResponse.json();
    if (!tempAuthToken) {
      throw new Error("Temporary authentication token was not received.");
    }
    console.log("[CLIENT] Temporary auth token received.");
    await fetchCsrfToken();
    if (!csrfToken) {
      throw new Error(
        "Could not retrieve a new security token for file upload.",
      );
    }
    // 1. Get image data from canvas as a Blob
    const designImageBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!designImageBlob) {
      throw new Error("Could not get image data from canvas.");
    }

    // 2. Upload the design image and optional cut line file
    showPaymentStatus("Uploading design...", "info");
    const uploadFormData = new FormData();
    uploadFormData.append("designImage", designImageBlob, "design.png");
    uploadFormData.append("_csrf", csrfToken); // Add CSRF token to form data

    const cutLineFileInput = document.getElementById("cutLineFile");
    if (cutLineFileInput && cutLineFileInput.files[0]) {
      uploadFormData.append("cutLineFile", cutLineFileInput.files[0]);
    }

    const uploadResponse = await fetch(`${serverUrl}/api/upload-design`, {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${tempAuthToken}`,
        "X-CSRF-Token": csrfToken,
      },
      body: uploadFormData,
    });

    const uploadData = await uploadResponse.json();
    if (!uploadResponse.ok) {
      throw new Error(uploadData.error || "Failed to upload design.");
    }
    const designImagePath = uploadData.designImagePath;
    const cutLinePath = uploadData.cutLinePath;
    console.log("[CLIENT] Design uploaded. Path:", designImagePath);
    if (cutLinePath) {
      console.log("[CLIENT] Cut line uploaded. Path:", cutLinePath);
    }

    // --- NEW: Build verificationDetails object ---
    const billingContact = {
      givenName: document.getElementById("firstName").value,
      familyName: document.getElementById("lastName").value,
      email: document.getElementById("email").value,
      phone: document.getElementById("phone").value,
      addressLines: [document.getElementById("address").value],
      city: document.getElementById("city").value,
      state: document.getElementById("state").value,
      postalCode: document.getElementById("postalCode").value,
      countryCode: "US",
    };

    const verificationDetails = {
      amount: (currentOrderAmountCents / 100).toFixed(2), // Must be a string
      currencyCode: "USD",
      intent: "CHARGE",
      billingContact: billingContact,
      customerInitiated: true,
      sellerKeyedIn: false,
    };
    // --- END NEW ---

    // 3. Tokenize the card with verification details
    showPaymentStatus("Securing card details...", "info");
    console.log("[CLIENT] Tokenizing card with verification details.");

    // UPDATED: Pass the new verificationDetails object to tokenize
    const sourceId = await tokenize(card, verificationDetails);

    console.log(
      "[CLIENT] Tokenization successful. Nonce (sourceId):",
      sourceId,
    );

    // 4. Create JSON payload for the order
    const orderDetails = {
      quantity: stickerQuantityInput
        ? parseInt(stickerQuantityInput.value, 10)
        : 0,
      material: stickerMaterialSelect ? stickerMaterialSelect.value : "unknown",
    };
    if (cutLinePath) {
      orderDetails.cutLinePath = cutLinePath;
    }

    // Prepare server contact object (ensure phoneNumber is set)
    const serverContact = {
      ...billingContact,
      phoneNumber: billingContact.phone,
      locality: billingContact.city,
      administrativeDistrictLevel1: billingContact.state,
      country: billingContact.countryCode,
    };

    const orderPayload = {
      sourceId,
      amountCents: currentOrderAmountCents,
      currency: "USD",
      designImagePath,
      orderDetails,
      billingContact: serverContact,
      shippingContact: serverContact, // Use same contact for shipping for now
      _csrf: csrfToken, // Add CSRF token to payload
      productId: currentProductId, // Include if it exists
    };

    // 5. Submit the order to the server
    showPaymentStatus("Submitting order to server...", "info");
    console.log("[CLIENT] Submitting order to server at /api/create-order");

    const response = await fetch(`${serverUrl}/api/create-order`, {
      method: "POST",
      credentials: "include", // Important for cookies
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tempAuthToken}`,
      },
      body: JSON.stringify(orderPayload),
    });

    const responseData = await response.json();

    if (!response.ok) {
      // Check if the error is a CSRF token error, and if so, fetch a new one
      if (responseData.error && responseData.error.includes("csrf")) {
        showPaymentStatus(
          "Your security token has expired. Please try submitting again.",
          "error",
        );
        console.warn("[CLIENT] CSRF token was invalid. Fetching a new one.");
        await fetchCsrfToken(); // Fetch a new token for the next attempt
      }
      throw new Error(
        responseData.error || "Failed to create order on server.",
      );
    }

    console.log("[CLIENT] Order created successfully on server:", responseData);
    showPaymentStatus(
      `Order successfully placed! Redirecting to your order history...`,
      "success",
    );

    // Redirect to the order history page with the token
    setTimeout(() => {
      window.location.href = `/orders.html?token=${tempAuthToken}`;
    }, 2000);
  } catch (error) {
    console.error("[CLIENT] Error during payment form submission:", error);
    showPaymentStatus(`Error: ${error.message}`, "error");
    if (submitPaymentBtn) {
      submitPaymentBtn.disabled = false;
      submitPaymentBtn.innerHTML = originalBtnContent;
    }
  }
}

// --- UI Helper Functions ---
function showPaymentStatus(message, type = "info") {
  if (!paymentStatusContainer) {
    console.error("Payment status container not found. Message:", message);
    return;
  }
  paymentStatusContainer.textContent = message;
  paymentStatusContainer.style.visibility = "visible";
  paymentStatusContainer.classList.remove(
    "payment-success",
    "payment-error",
    "payment-info",
  );
  if (type === "success") {
    paymentStatusContainer.classList.add("payment-success");
  } else if (type === "error") {
    paymentStatusContainer.classList.add("payment-error");
  } else {
    paymentStatusContainer.classList.add("payment-info");
  }
}

function updateUnitUI(isMetric) {
  const inchesToMm = 25.4;
  const sizeBtns = document.querySelectorAll(".size-btn");
  const resizeSliderEl = document.getElementById("resizeSlider");
  const resizeInputNumberEl = document.getElementById("resizeInput");
  const resizeUnitLabelEl = document.getElementById("resizeUnitLabel");
  const designMarginNoteEl = document.getElementById("designMarginNote");

  sizeBtns.forEach((btn) => {
    const inches = parseFloat(btn.dataset.size);
    if (isMetric) {
      const mm = (inches * inchesToMm).toFixed(0);
      btn.textContent = `${mm}mm`;
      btn.setAttribute("aria-label", `Set max dimension to ${mm} millimeters`);
    } else {
      btn.textContent = `${inches}"`;
      btn.setAttribute(
        "aria-label",
        `Set max dimension to ${inches} ${inches === 1 ? "inch" : "inches"}`,
      );
    }
  });

  if (resizeSliderEl && resizeInputNumberEl) {
    let currentValue = parseFloat(resizeSliderEl.value);
    if (isMetric) {
      if (!resizeSliderEl.dataset.originalMin) {
        resizeSliderEl.dataset.originalMin = resizeSliderEl.min;
        resizeSliderEl.dataset.originalMax = resizeSliderEl.max;
        resizeSliderEl.dataset.originalStep = resizeSliderEl.step;
      }
      resizeSliderEl.min = resizeSliderEl.dataset.originalMin * inchesToMm;
      resizeSliderEl.max = resizeSliderEl.dataset.originalMax * inchesToMm;
      resizeSliderEl.step =
        (resizeSliderEl.dataset.originalStep * inchesToMm) / 10;
      resizeSliderEl.value = currentValue * inchesToMm;
      if (resizeInputNumberEl)
        resizeInputNumberEl.value = (currentValue * inchesToMm).toFixed(1);
      if (resizeUnitLabelEl) resizeUnitLabelEl.textContent = "mm";
    } else {
      if (resizeSliderEl.dataset.originalMin) {
        resizeSliderEl.min = resizeSliderEl.dataset.originalMin;
        resizeSliderEl.max = resizeSliderEl.dataset.originalMax;
        resizeSliderEl.step = resizeSliderEl.dataset.originalStep;
        resizeSliderEl.value = currentValue / inchesToMm;
        if (resizeInputNumberEl)
          resizeInputNumberEl.value = (currentValue / inchesToMm).toFixed(1);
        if (resizeUnitLabelEl) resizeUnitLabelEl.textContent = "in";
      }
    }
    if (resizeInputNumberEl) {
      resizeSliderEl.setAttribute(
        "aria-valuetext",
        `${resizeInputNumberEl.value} ${isMetric ? "mm" : "in"}`,
      );
    }
  }

  if (designMarginNoteEl) {
    if (isMetric) {
      designMarginNoteEl.textContent =
        "Keep important elements 2-3mm from edge!";
    } else {
      designMarginNoteEl.textContent =
        "Keep important elements 0.08-0.12in from edge!";
    }
  }
}

function updateEditingButtonsState(disabled) {
  const elements = [
    rotateLeftBtnEl,
    rotateRightBtnEl,
    grayscaleBtnEl,
    sepiaBtnEl,
    document.getElementById("resizeSlider"),
    document.getElementById("generateCutlineBtn"),
    textInput,
    textSizeInput,
    textSizeSlider,
    textColorInput,
    addTextBtn,
    textFontFamilySelect,
  ];
  const disabledClasses = ["opacity-50", "cursor-not-allowed"];
  elements.forEach((el) => {
    if (el) {
      el.disabled = disabled;
      if (disabled) el.classList.add(...disabledClasses);
      else el.classList.remove(...disabledClasses);
    }
  });
  if (designMarginNote)
    designMarginNote.style.display = disabled ? "none" : "block";
  if (textEditingControlsContainer)
    textEditingControlsContainer.hidden = disabled;
  if (canvasPlaceholder)
    canvasPlaceholder.style.display = disabled ? "flex" : "none";
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

  // Update CSS size to match logical size
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;
}

function saveCleanState() {
  if (!canvas || !ctx) return;
  cleanCanvasState = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function restoreCleanState() {
  if (!canvas || !ctx || !cleanCanvasState) return;
  // Use putImageData to bypass transformations and draw directly to device pixels
  ctx.putImageData(cleanCanvasState, 0, 0);
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
  if (file.type === "image/svg+xml") {
    // Reset raster image state
    originalImage = null;
    reader.onload = (e) => {
      handleSvgUpload(e.target.result);
    };
    reader.onerror = () =>
      showPaymentStatus("Error reading SVG file.", "error");
    reader.readAsText(file);
  } else if (file.type.startsWith("image/")) {
    // Reset vector state
    currentPolygons = [];
    basePolygons = [];
    rasterCutlinePoly = null; // Clear raster cutline
    currentCutline = [];
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        updateEditingButtonsState(false);
        showPaymentStatus("Image loaded successfully.", "success");
        let newWidth = img.width,
          newHeight = img.height;
        if (canvas && ctx) {
          setCanvasSize(newWidth, newHeight);
          ctx.clearRect(0, 0, newWidth, newHeight);
          ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

          saveCleanState(); // Save state before decorations

          // For raster images, the bounds and cutline are the canvas itself.
          currentBounds = {
            left: 0,
            top: 0,
            right: newWidth,
            bottom: newHeight,
            width: newWidth,
            height: newHeight,
          };
          currentCutline = [
            [
              { x: 0, y: 0 },
              { x: newWidth, y: 0 },
              { x: newWidth, y: newHeight },
              { x: 0, y: newHeight },
            ],
          ];
          currentPolygons = []; // Clear any previous SVG data

          // Update the price now that we have dimensions
          calculateAndUpdatePrice();
          drawCanvasDecorations(currentBounds); // Draw the initial bounding box, size indicator, and rulers

          // Bolt Fix: Default to 2 inches on import
          if (pricingConfig) {
            handleStandardResize(2);

            // Update Slider UI
            const resizeSliderEl = document.getElementById("resizeSlider");
            const resizeInputNumberEl = document.getElementById("resizeInput");
            const resizeUnitLabelEl = document.getElementById("resizeUnitLabel");

            if (resizeSliderEl && resizeInputNumberEl) {
              const val = isMetric ? 2 * 25.4 : 2;
              resizeSliderEl.value = val;
              resizeInputNumberEl.value = val.toFixed(1);
              if (resizeUnitLabelEl) resizeUnitLabelEl.textContent = isMetric ? "mm" : "in";
            }
          }
        }
      };
      img.onerror = () =>
        showPaymentStatus("Error loading image data.", "error");
      img.src = reader.result;
    };
    reader.onerror = () => showPaymentStatus("Error reading file.", "error");
    reader.readAsDataURL(file);
  } else {
    showPaymentStatus(
      "Invalid file type. Please select an image or SVG file.",
      "error",
    );
  }
}

function redrawAll() {
  if (currentPolygons.length === 0) {
    // Handle raster image redrawing if necessary (or do nothing if canvas is source of truth)
    return;
  }

  // Generate the cutline from the current state of the polygons
  const cutline = generateCutLine(currentPolygons, cutlineOffset); // Use dynamic offset

  // Store the results globally
  currentCutline = cutline;
  currentBounds = getPolygonsBounds(cutline);

  // --- VALIDATION ---
  // Ensure the bounds are valid before attempting to redraw the canvas
  if (
    !currentBounds ||
    currentBounds.right - currentBounds.left <= 0 ||
    currentBounds.bottom - currentBounds.top <= 0
  ) {
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
  const drawOffset = {
    x: -currentBounds.left + 20,
    y: -currentBounds.top + 20,
  };

  // Draw everything
  drawPolygonsToCanvas(currentPolygons, "black", drawOffset);
  drawPolygonsToCanvas(currentCutline, "red", drawOffset, true);
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
    const elements = parser.svgRoot.querySelectorAll(
      "path, rect, circle, ellipse, polygon, polyline",
    );

    elements.forEach((element) => {
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
    const cutline = generateCutLine(polygons, cutlineOffset); // Use dynamic offset

    // Store the results globally
    basePolygons = polygons; // Store the original, unscaled polygons
    currentPolygons = polygons;
    currentCutline = cutline;
    // Calculate the bounds of the final cutline for pricing and display
    currentBounds = getPolygonsBounds(cutline);

    // Set canvas size based on the final cutline bounds
    canvas.width = currentBounds.right - currentBounds.left + 40; // Add padding
    canvas.height = currentBounds.bottom - currentBounds.top + 40;

    // Create an offset for drawing, so the shape isn't at the very edge
    const drawOffset = {
      x: -currentBounds.left + 20,
      y: -currentBounds.top + 20,
    };

    // Initial drawing
    redrawAll();

    showPaymentStatus("SVG processed and cutline generated.", "success");
    updateEditingButtonsState(false); // Enable editing buttons
  } catch (error) {
    showPaymentStatus(`SVG Processing Error: ${error.message}`, "error");
    console.error(error);
  }
}

function generateCutLine(polygons, offset) {
  const scale = 100; // Scale for integer precision
  const scaledPolygons = polygons.map((p) => {
    return p.map((point) => ({ X: point.x * scale, Y: point.y * scale }));
  });

  const co = new ClipperLib.ClipperOffset();
  const offsetted_paths = new ClipperLib.Paths();

  co.AddPaths(
    scaledPolygons,
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  );
  co.Execute(offsetted_paths, offset * scale);

  // Scale back down
  const cutline = offsetted_paths.map((p) => {
    return p.map((point) => ({ x: point.X / scale, y: point.Y / scale }));
  });

  return cutline;
}

function drawPolygonsToCanvas(
  polygons,
  style,
  offset = { x: 0, y: 0 },
  stroke = false,
) {
  if (!ctx || polygons.length === 0) return;

  // Bolt Optimization: Batch all polygons into a single path to reduce draw calls
  ctx.beginPath();

  polygons.forEach((poly) => {
    if (poly.length === 0) return;

    ctx.moveTo(poly[0].x + offset.x, poly[0].y + offset.y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x + offset.x, poly[i].y + offset.y);
    }
    ctx.closePath();
  });

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
}

function drawCanvasDecorations(bounds, offset = { x: 0, y: 0 }) {
  if (!bounds) return;

  // In Raster Mode (where basePolygons is empty), we need to restore the clean image first to wipe old decorations.
  if (basePolygons.length === 0 && cleanCanvasState) {
    restoreCleanState();
  }

  drawBoundingBox(bounds, offset);
  drawSizeIndicator(bounds, offset);
  drawRuler(bounds, offset);

  // In Raster Mode (where basePolygons is empty), we need to draw the cutline overlay manually
  // because we don't use redrawAll().
  if (basePolygons.length === 0 && currentCutline && currentCutline.length > 0) {
    drawPolygonsToCanvas(currentCutline, "red", offset, true);
  }
}

function drawBoundingBox(bounds, offset = { x: 0, y: 0 }) {
  if (!ctx || !bounds || !pricingConfig) {
    return;
  }

  ctx.save();

  // The user wanted a grey box with 1-inch dashes for pricing.
  // The previous implementation calculated a dash length from PPI, which was often
  // too large to be visible on smaller images. A fixed dash pattern is more reliable.

  // Set color to grey as requested.
  ctx.strokeStyle = "rgba(128, 128, 128, 0.9)"; // A strong, visible grey
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

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();

  ctx.restore();
}

function drawSizeIndicator(bounds, offset = { x: 0, y: 0 }) {
  if (!ctx || !bounds || !pricingConfig || !stickerResolutionSelect) return;

  const ppi =
    pricingConfig.resolutions.find(
      (r) => r.id === stickerResolutionSelect.value,
    )?.ppi || 96;
  let width = bounds.width / ppi;
  let height = bounds.height / ppi;
  let unit = "in";

  if (isMetric) {
    width *= 25.4;
    height *= 25.4;
    unit = "mm";
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  // Position the text slightly above the top edge of the bounding box
  ctx.fillText(
    `${width.toFixed(1)} ${unit}`,
    offset.x + bounds.width / 2,
    offset.y - 10,
  );

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
  const ppi =
    pricingConfig.resolutions.find(
      (r) => r.id === stickerResolutionSelect.value,
    )?.ppi || 96;
  drawCanvasRuler(ctx, bounds, offset, ppi, isMetric);
}

function handleAddText() {
  if (!canvas || !ctx || !originalImage) {
    showPaymentStatus("Please load an image before adding text.", "error");
    return;
  }
  const text = textInput.value;
  const size = parseInt(textSizeInput.value, 10);
  const color = textColorInput.value;
  const font = textFontFamilySelect.value;
  if (!text.trim() || isNaN(size) || size <= 0) {
    showPaymentStatus("Please enter valid text and size.", "error");
    return;
  }
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  showPaymentStatus(`Text "${text}" added.`, "success");
}

function handleResetImage() {
  if (!originalImage && basePolygons.length === 0) {
    showPaymentStatus("Nothing to reset.", "info");
    return;
  }

  if (
    !confirm(
      "Are you sure you want to reset your changes? This action cannot be undone.",
    )
  ) {
    return;
  }

  if (originalImage) {
    // Raster Image Reset
    isGrayscale = false;
    isSepia = false;
    basePolygons = [];
    currentPolygons = [];
    currentCutline = [];
    rasterCutlinePoly = null; // Bolt Fix: Clear raster cutline on reset

    let newWidth = originalImage.width,
      newHeight = originalImage.height;

    if (canvas && ctx) {
      setCanvasSize(newWidth, newHeight);
      ctx.clearRect(0, 0, newWidth, newHeight);
      ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

      saveCleanState(); // Save state before decorations

      currentBounds = {
        left: 0,
        top: 0,
        right: newWidth,
        bottom: newHeight,
        width: newWidth,
        height: newHeight,
      };
      currentCutline = [
        [
          { x: 0, y: 0 },
          { x: newWidth, y: 0 },
          { x: newWidth, y: newHeight },
          { x: 0, y: newHeight },
        ],
      ];

      updateFilterButtonVisuals();

      // Reset Slider
      const resizeSliderEl = document.getElementById("resizeSlider");
      const resizeInputNumberEl = document.getElementById("resizeInput");
      const resizeUnitLabelEl = document.getElementById("resizeUnitLabel");
      if (resizeSliderEl) {
        if (pricingConfig && stickerResolutionSelect) {
          const selectedResolution = pricingConfig.resolutions.find(
            (r) => r.id === stickerResolutionSelect.value,
          );
          const ppi = selectedResolution ? selectedResolution.ppi : 96;
          let maxDimPixels = Math.max(newWidth, newHeight);
          let maxDimInches = maxDimPixels / ppi;

          if (isMetric) {
            resizeSliderEl.value = maxDimInches * 25.4;
            if (resizeInputNumberEl)
              resizeInputNumberEl.value = (maxDimInches * 25.4).toFixed(1);
            if (resizeUnitLabelEl) resizeUnitLabelEl.textContent = "mm";
          } else {
            resizeSliderEl.value = maxDimInches;
            if (resizeInputNumberEl)
              resizeInputNumberEl.value = maxDimInches.toFixed(1);
            if (resizeUnitLabelEl) resizeUnitLabelEl.textContent = "in";
          }
          if (resizeInputNumberEl) {
            resizeSliderEl.setAttribute(
              "aria-valuetext",
              `${resizeInputNumberEl.value} ${isMetric ? "mm" : "in"}`,
            );
          }
        }
      }

      calculateAndUpdatePrice();
      drawCanvasDecorations(currentBounds);
      showPaymentStatus("Image reset to original.", "success");
    }
  } else if (basePolygons.length > 0) {
    // SVG Reset
    currentPolygons = basePolygons;
    redrawAll();
    showPaymentStatus("Image reset to original.", "success");
  }
}

function rotateCanvasContentFixedBounds(angleDegrees) {
  if (basePolygons.length > 0) {
    // SVG Vector Rotation
    const bounds = getPolygonsBounds(currentPolygons);
    const centerX = bounds.left + (bounds.right - bounds.left) / 2;
    const centerY = bounds.top + (bounds.bottom - bounds.top) / 2;
    const angleRad = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    currentPolygons = currentPolygons.map((poly) =>
      poly.map((point) => {
        // Translate point to origin
        const translatedX = point.x - centerX;
        const translatedY = point.y - centerY;
        // Rotate point
        const rotatedX = translatedX * cos - translatedY * sin;
        const rotatedY = translatedX * sin + translatedY * cos;
        // Translate point back
        return { x: rotatedX + centerX, y: rotatedY + centerY };
      }),
    );
    redrawAll();
  } else if (originalImage) {
    // Use the current canvas dimensions, which represent the scaled image size
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;

    // Swap dimensions for 90/270 degree rotations
    const newW = angleDegrees === 90 || angleDegrees === -90 ? h : w;
    const newH = angleDegrees === 90 || angleDegrees === -90 ? w : h;

    // Calculate logical dimensions for setCanvasSize (which multiplies by DPR)
    const newLogicalW = newW / dpr;
    const newLogicalH = newH / dpr;

    // Create a new in-memory canvas to draw the rotated image on
    // Use physical dimensions to preserve quality
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");

    // Set the dimensions of the temp canvas to the new width and height
    tempCanvas.width = newW;
    tempCanvas.height = newH;

    // Translate to the center of the temp canvas, rotate, and draw the current canvas content
    tempCtx.translate(newW / 2, newH / 2);
    tempCtx.rotate((angleDegrees * Math.PI) / 180);

    // Draw the image from the main canvas onto the temp canvas
    // This preserves all current transformations (scale, filters)
    // We draw the physical canvas directly
    tempCtx.drawImage(canvas, -w / 2, -h / 2);

    // Now, update the main canvas with the rotated image
    // Pass LOGICAL dimensions
    setCanvasSize(newLogicalW, newLogicalH);

    // Draw the temp canvas onto the main canvas
    // Since setCanvasSize sets a transform (scale(dpr)), we must reset it temporarily
    // to draw our physical-pixel tempCanvas 1:1 onto the physical-pixel main canvas.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, newW, newH);
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore(); // Restore the transform for subsequent drawing operations (decorations)

    saveCleanState(); // Save state before decorations

    // Handle Raster Cutline Rotation (Overlay Mode)
    if (rasterCutlinePoly) {
        const angleRad = (angleDegrees * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const dpr = window.devicePixelRatio || 1;
        const oldCenterX = (w / dpr) / 2;
        const oldCenterY = (h / dpr) / 2;
        const newCenterX = (newW / dpr) / 2;
        const newCenterY = (newH / dpr) / 2;

        rasterCutlinePoly = rasterCutlinePoly.map(poly => poly.map(p => {
            // Translate to old center
            const tx = p.x - oldCenterX;
            const ty = p.y - oldCenterY;
            // Rotate
            const rx = tx * cos - ty * sin;
            const ry = tx * sin + ty * cos;
            // Translate to new center
            return { x: rx + newCenterX, y: ry + newCenterY };
        }));

        // Regenerate currentCutline from rotated poly
        const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
        currentCutline = cutline;
        currentBounds = getPolygonsBounds(cutline);
    } else {
        // Default bounds if no cutline
        currentBounds = {
            left: 0,
            top: 0,
            right: newW,
            bottom: newH,
            width: newW,
            height: newH,
        };
        currentCutline = [[
            { x: 0, y: 0 },
            { x: newW, y: 0 },
            { x: newW, y: newH },
            { x: 0, y: newH },
        ]];
    }

    calculateAndUpdatePrice();
    drawCanvasDecorations(currentBounds);
  }
}

function redrawOriginalImageWithFilters() {
  if (!originalImage || !ctx || !canvas) return;

  // Bolt Optimization: Use hardware-accelerated Canvas filters via helper
  drawImageWithFilters(ctx, originalImage, canvas.width, canvas.height, {
    grayscale: isGrayscale,
    sepia: isSepia,
  });

  saveCleanState(); // Save state before decorations

  // Explicitly restore stroke style before drawing decorations
  ctx.strokeStyle = "rgba(128, 128, 128, 0.9)";
  ctx.lineWidth = 2;

  // Also redraw the bounding box and size indicator, which are cleared by the operation.
  if (currentBounds) {
    drawCanvasDecorations(currentBounds);
  }
}

function updateFilterButtonVisuals() {
  const setStyle = (el, active) => {
    if (!el) return;
    el.setAttribute("aria-pressed", active);
    if (active) {
      el.style.setProperty(
        "transform",
        "scale(0.95) translateY(2px)",
        "important",
      );
      el.style.setProperty(
        "box-shadow",
        "inset 0 3px 5px rgba(0,0,0,0.5)",
        "important",
      );
      el.style.setProperty("filter", "brightness(0.9)", "important");
      // Ensure text remains readable
      el.style.setProperty(
        "border",
        "2px solid rgba(255,255,255,0.5)",
        "important",
      );
    } else {
      el.style.removeProperty("transform");
      el.style.removeProperty("box-shadow");
      el.style.removeProperty("filter");
      el.style.removeProperty("border");
    }
  };
  // Ensure we have the latest elements if globals are not ready or lost
  const grayEl = grayscaleBtnEl || document.getElementById("grayscaleBtn");
  const sepiaEl = sepiaBtnEl || document.getElementById("sepiaBtn");

  setStyle(grayEl, isGrayscale);
  setStyle(sepiaEl, isSepia);
}

function toggleGrayscaleFilter() {
  if (!canvas || !ctx || !originalImage) return;

  const wasOn = isGrayscale;
  isGrayscale = !wasOn; // Toggle state
  isSepia = false; // Ensure sepia is off

  updateFilterButtonVisuals();
  redrawOriginalImageWithFilters();
}

function toggleSepiaFilter() {
  if (!canvas || !ctx || !originalImage) return;

  const wasOn = isSepia;
  isSepia = !wasOn; // Toggle state
  isGrayscale = false; // Ensure grayscale is off

  updateFilterButtonVisuals();
  redrawOriginalImageWithFilters();
}

function handleStandardResize(targetInches) {
  if (!pricingConfig || (!originalImage && basePolygons.length === 0)) {
    showPaymentStatus("Please load an image first.", "error");
    return;
  }

  const selectedResolution = pricingConfig.resolutions.find(
    (r) => r.id === stickerResolutionSelect.value,
  );
  if (!selectedResolution) return;

  const ppi = selectedResolution.ppi;
  const targetPixels = targetInches * ppi;

  let currentMaxWidthPixels;
  if (basePolygons.length > 0) {
    const bounds = getPolygonsBounds(basePolygons);
    currentMaxWidthPixels = Math.max(bounds.width, bounds.height);
  } else {
    currentMaxWidthPixels = Math.max(originalImage.width, originalImage.height);
  }

  if (currentMaxWidthPixels <= 0) return;

  const scale = targetPixels / currentMaxWidthPixels;

  // Update Size Buttons State
  const sizeBtns = document.querySelectorAll(".size-btn");
  sizeBtns.forEach((btn) => {
    const size = parseFloat(btn.dataset.size);
    // Use a small epsilon for float comparison
    if (Math.abs(size - targetInches) < 0.05) {
      btn.setAttribute("aria-pressed", "true");
      // Use setProperty with 'important' to override aggressive themes
      btn.style.setProperty(
        "background-color",
        "var(--splotch-red)",
        "important",
      );
      btn.style.setProperty("color", "white", "important");
      btn.style.setProperty("border-color", "var(--splotch-red)", "important");
      btn.style.fontWeight = "bold";
    } else {
      btn.setAttribute("aria-pressed", "false");
      btn.style.removeProperty("background-color");
      btn.style.removeProperty("color");
      btn.style.removeProperty("border-color");
      btn.style.fontWeight = "";
    }
  });

  if (basePolygons.length > 0) {
    // SVG Vector Resizing - always scale from the original
    currentPolygons = basePolygons.map((poly) =>
      poly.map((point) => ({ x: point.x * scale, y: point.y * scale })),
    );
    redrawAll();
  } else if (originalImage) {
    const prevWidth = canvas.width;
    const prevHeight = canvas.height;

    // Raster Image Resizing - always use the original image to prevent quality loss
    const newWidth = originalImage.width * scale;
    const newHeight = originalImage.height * scale;

    if (newWidth > 0 && newHeight > 0) {
      setCanvasSize(newWidth, newHeight);
      ctx.clearRect(0, 0, newWidth, newHeight);
      ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

      saveCleanState(); // Save state before decorations

      // Handle Raster Cutline Scaling (Overlay Mode)
      if (rasterCutlinePoly && prevWidth > 0 && prevHeight > 0) {
          // Bolt Fix: Calculate scale based on LOGICAL dimensions to match rasterCutlinePoly coordinate space
          const dpr = window.devicePixelRatio || 1;
          const prevLogicalWidth = prevWidth / dpr;
          const prevLogicalHeight = prevHeight / dpr;

          const scaleX = newWidth / prevLogicalWidth;
          const scaleY = newHeight / prevLogicalHeight;

          rasterCutlinePoly = rasterCutlinePoly.map(poly => poly.map(p => ({
              x: p.x * scaleX,
              y: p.y * scaleY
          })));

          // Regenerate currentCutline
          const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
          currentCutline = cutline;
          currentBounds = getPolygonsBounds(cutline);
      } else {
          // Update the bounds and cutline for the new raster size (Default Box)
          currentBounds = {
            left: 0,
            top: 0,
            right: newWidth,
            bottom: newHeight,
            width: newWidth,
            height: newHeight,
          };
          currentCutline = [
            [
              { x: 0, y: 0 },
              { x: newWidth, y: 0 },
              { x: newWidth, y: newHeight },
              { x: 0, y: newHeight },
            ],
          ];
      }

      // Trigger the price update and redraw the bounding box
      calculateAndUpdatePrice();
      drawCanvasDecorations(currentBounds);
    }
  }
}

// --- Smart Cutline Generation ---

function handleGenerateCutline() {
  if (!canvas || !ctx || !originalImage) {
    showPaymentStatus(
      "Smart cutline requires a raster image (PNG, JPG). Please upload one.",
      "error",
    );
    return;
  }

  // --- Feedforward Check ---
  // Pass the imageData to the function
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (!imageHasTransparentBorder(currentImageData)) {
    const proceed = confirm(
      "This image does not appear to have a transparent or white background. The 'Smart Cutline' feature may not produce a good result. Proceed anyway?",
    );
    if (!proceed) {
      return;
    }
  }

  showPaymentStatus("Generating smart cutline...", "info");

  // START LOADING STATE
  const btn = document.getElementById("generateCutlineBtn");
  const originalText = btn ? btn.innerHTML : "Generate Smart Cutline";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
            <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Generating...</span>
        `;
  }

  // Save the current canvas state so we can restore it if tracing fails.
  const originalCanvasData = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  // Use a timeout to allow the UI to update before the heavy computation
  setTimeout(() => {
    try {
      let imageData;
      if (cleanCanvasState && cleanCanvasState.width === canvas.width && cleanCanvasState.height === canvas.height) {
         imageData = cleanCanvasState;
      } else {
         imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      const contours = traceContours(imageData, cutlineSensitivity);

      if (!contours || contours.length === 0) {
        throw new Error(
          "Could not find any distinct contour. Image may be empty.",
        );
      }

      // Filter contours to remove noise (e.g. area < 100 pixels)
      // Bolt Optimization: Use a dynamic threshold based on image size to filter noise spots (islands)
      const imageArea = canvas.width * canvas.height;
      const minIslandArea = Math.max(100, imageArea * 0.0001); // At least 100px, or 0.01% of image
      let significantContours = contours.filter((c) => getPolygonArea(c) > minIslandArea);

      // Suppress "island cuts" (internal holes) that are larger than 2mm.
      // Constraint: "we can have internal cuts, but they should be less than 2mm"
      // Interpretation: Keep internal cuts <= 2mm. Remove internal cuts > 2mm.
      if (significantContours.length > 0) {
          const selectedResolutionId = stickerResolutionSelect ? stickerResolutionSelect.value : 'dpi_300';
          const selectedResolution = pricingConfig && pricingConfig.resolutions
            ? pricingConfig.resolutions.find((r) => r.id === selectedResolutionId)
            : null;

          const ppi = selectedResolution ? selectedResolution.ppi : 300;
          // Calculate 2mm in pixels for max hole size
          const maxAllowedHoleSize = (2 / 25.4) * ppi;
          // Calculate 0.5mm in pixels for min hole size (noise floor)
          const minAllowedHoleSize = (0.5 / 25.4) * ppi;

          significantContours = filterInternalContours(significantContours, maxAllowedHoleSize, minAllowedHoleSize);
      }

      if (significantContours.length === 0) {
        throw new Error(
          "No significant shapes found. Image may be too noisy or empty.",
        );
      }

      const scale = 100;
      const finalContours = [];

      significantContours.forEach((contour) => {
        // The raw contour is too detailed, simplify it using the RDP algorithm.
        const simplifiedContour = simplifyPolygon(contour, 0.5); // Epsilon of 0.5 pixels

        // Bolt Optimization: Apply smoothing to round sharp corners ("surface energy minimization")
        // 2 iterations of Chaikin's algorithm gives nice rounded corners without adding too many vertices
        const smoothedContour = smoothPolygon(simplifiedContour, 2);

        // Clean the polygon to remove self-intersections and other issues before offsetting.
        // This requires scaling up for Clipper's integer math.
        const scaledPoly = smoothedContour.map((p) => ({
          X: p.x * scale,
          Y: p.y * scale,
        }));
        const cleanedScaledPoly = ClipperLib.Clipper.CleanPolygon(
          scaledPoly,
          0.1,
        );

        // Add validation to ensure we have a usable polygon AFTER cleaning
        if (cleanedScaledPoly && cleanedScaledPoly.length >= 3) {
          finalContours.push(
            cleanedScaledPoly.map((p) => ({
              x: p.X / scale,
              y: p.Y / scale,
            })),
          );
        }
      });

      if (finalContours.length === 0) {
        throw new Error(
          "Could not detect a usable outline. Try an image with a transparent background.",
        );
      }

      // Set the raster cutline polygon (Overlay Mode)
      const dpr = window.devicePixelRatio || 1;
      rasterCutlinePoly = finalContours.map(poly => poly.map(p => ({
          x: p.x / dpr,
          y: p.y / dpr
      })));

      // Generate the cutline immediately
      const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
      currentCutline = cutline;
      currentBounds = getPolygonsBounds(cutline);

      // Redraw decorations (which will now include the cutline overlay)
      // Note: We are drawing on top of the existing canvas. Previous decorations might be baked in if not cleared,
      // but this preserves the raster image state (rotation, etc).
      drawCanvasDecorations(currentBounds);

      calculateAndUpdatePrice();
      showPaymentStatus("Smart cutline generated successfully.", "success");
    } catch (error) {
      // Restore the original canvas if the process failed
      ctx.putImageData(originalCanvasData, 0, 0);
      showPaymentStatus(`Error: ${error.message}`, "error");
      console.error(error);
    } finally {
      // RESTORE BUTTON STATE
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }, 50);
}

// --- Creator / Product Functions ---
async function checkAuthStatus() {
  try {
    // Check localStorage for token (support both keys for backward compatibility)
    const token = localStorage.getItem("authToken") || localStorage.getItem("splotch_token");

    if (token) {
      const verifyRes = await fetch(`${serverUrl}/api/auth/verify-token`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (verifyRes.ok) {
        const sellBtn = document.getElementById("sellDesignBtn");
        if (sellBtn) sellBtn.classList.remove("hidden");
      }
    }
  } catch (e) {
    // Not logged in
  }
}

async function handleCreateProduct() {
  const name = document.getElementById("productName").value;
  const profitInput = document.getElementById("creatorProfit").value;
  const profitCents = Math.round(parseFloat(profitInput) * 100);

  if (!name || isNaN(profitCents)) {
    alert("Please enter a valid name and profit amount.");
    return;
  }

  // We need to upload the file first if it's not already on the server?
  // Actually, handlePaymentFormSubmit uploads it. We need a similar flow here.
  // OR we reuse the upload endpoint.
  // But `handleFileChange` just reads locally.

  // 1. Get auth token
  const token = localStorage.getItem("authToken") || localStorage.getItem("splotch_token");
  if (!token) {
    alert("You must be logged in to sell designs.");
    return;
  }

  try {
    // 2. Upload Design
    const designImageBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const uploadFormData = new FormData();
    uploadFormData.append("designImage", designImageBlob, "design.png");
    uploadFormData.append("_csrf", csrfToken);

    // Use existing upload endpoint
    const uploadResponse = await fetch(`${serverUrl}/api/upload-design`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-CSRF-Token": csrfToken,
      },
      body: uploadFormData,
    });
    const uploadData = await uploadResponse.json();
    if (!uploadResponse.ok)
      throw new Error(uploadData.error || "Upload failed");

    // 3. Create Product
    const productPayload = {
      name,
      creatorProfitCents: profitCents,
      designImagePath: uploadData.designImagePath,
      cutLinePath: uploadData.cutLinePath,
      _csrf: csrfToken,
    };

    const createResponse = await fetch(`${serverUrl}/api/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(productPayload),
    });

    const createData = await createResponse.json();
    if (!createResponse.ok)
      throw new Error(createData.error || "Creation failed");

    // 4. Show Link
    const link = `${window.location.origin}${window.location.pathname}?product_id=${createData.product.productId}`;
    document.getElementById("productLinkInput").value = link;
    document.getElementById("productLinkContainer").classList.remove("hidden");
    document.getElementById("createProductBtn").classList.add("hidden"); // Prevent double click
  } catch (error) {
    console.error(error);
    alert("Failed to create product: " + error.message);
  }
}

async function handleRemoteImageLoad(imageUrl) {
  showPaymentStatus("Loading your previous design...", "info");
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.onload = () => {
    originalImage = img;
    updateEditingButtonsState(false); // Enable editing

    // Standard canvas init logic
    let newWidth = img.width,
      newHeight = img.height;
    setCanvasSize(newWidth, newHeight);
    ctx.clearRect(0, 0, newWidth, newHeight);
    ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

    saveCleanState(); // Save state before decorations

    // Default bounds and cutline
    currentBounds = {
      left: 0,
      top: 0,
      right: newWidth,
      bottom: newHeight,
      width: newWidth,
      height: newHeight,
    };
    rasterCutlinePoly = null; // Clear raster cutline
    currentCutline = [
      [
        { x: 0, y: 0 },
        { x: newWidth, y: 0 },
        { x: newWidth, y: newHeight },
        { x: 0, y: newHeight },
      ],
    ];

    calculateAndUpdatePrice();
    drawCanvasDecorations(currentBounds);
    showPaymentStatus("Design loaded! You can now adjust options.", "success");
  };
  img.onerror = () =>
    showPaymentStatus("Failed to load design image.", "error");
  img.src = decodeURIComponent(imageUrl);
}

async function loadProductForBuyer(productId) {
  try {
    currentProductId = productId;
    showPaymentStatus("Loading product design...", "info");

    const response = await fetch(`${serverUrl}/api/products/${productId}`);
    if (!response.ok) throw new Error("Product not found");

    const product = await response.json();

    // Set Pricing Markup
    creatorProfitCents = product.creatorProfitCents;

    // Load Image
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      // Draw
      let newWidth = img.width,
        newHeight = img.height;
      setCanvasSize(newWidth, newHeight);
      ctx.clearRect(0, 0, newWidth, newHeight);
      ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

      saveCleanState(); // Save state before decorations

      // Mock Cutline if not provided (or parse it if it is)
      // For MVP, if there is no cutline path in response, we default to box?
      // Actually, products should have cutlines if they were created via the UI.
      // But we don't have code to load the cutline from a file URL back into `currentCutline` polygons easily
      // without parsing the SVG again.
      // Hackerman shortcut: Just use the bounds of the image for now or trigger auto-trace?
      // Better: If we have the image, we can just treat it as a fresh load.
      // But we should "Lock" the UI.

      // Generate basic bounds
      currentBounds = {
        left: 0,
        top: 0,
        right: newWidth,
        bottom: newHeight,
        width: newWidth,
        height: newHeight,
      };
      rasterCutlinePoly = null; // Clear raster cutline
      currentCutline = [
        [
          { x: 0, y: 0 },
          { x: newWidth, y: 0 },
          { x: newWidth, y: newHeight },
          { x: 0, y: newHeight },
        ],
      ];
      // If the product had a complex cutline, we aren't loading it visually here for the buyer
      // unless we fetch and parse the SVG.
      // For this MVP, let's trigger the "Smart Cutline" automatically if it looks transparent?
      // Or just default to rectangle.

      // LOCK UI
      updateEditingButtonsState(true); // Disable all editing
      // Re-enable resize
      if (resizeBtnEl) resizeBtnEl.disabled = false;
      document.getElementById("resizeSlider").disabled = false;

      // Hide "Sell" button
      const sellBtn = document.getElementById("sellDesignBtn");
      if (sellBtn) sellBtn.style.display = "none";

      // Hide Upload Input
      if (fileInputGlobalRef)
        fileInputGlobalRef.closest(".field").style.display = "none";

      // Show "Supporting" message
      if (product.creatorName) {
        const header = document.querySelector("h1");
        const supportMsg = document.createElement("div");
        supportMsg.className = "text-center text-green-600 font-bold mb-4";
        supportMsg.textContent = `Supporting Artist: ${product.creatorName}`;
        header.insertAdjacentElement("afterend", supportMsg);
      }

      calculateAndUpdatePrice();
      drawCanvasDecorations(currentBounds);
      showPaymentStatus("Design loaded!", "success");
    };
    img.crossOrigin = "Anonymous"; // Important for canvas manipulation if on different port
    img.src = product.designImagePath;
  } catch (error) {
    console.error(error);
    showPaymentStatus("Failed to load product.", "error");
  }
}
