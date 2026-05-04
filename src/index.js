import { SVGParser } from "./lib/svgparser.js";
import {
  calculateStickerPrice,
  calculatePerimeter,
  generateSvgFromCutline,
} from "./lib/pricing.js";
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
import { showNotification } from "./notifications.js";

// index.js

const appId = "sandbox-sq0idb-tawTw_Vl7VGYI6CZfKEshA";
const locationId = "LTS82DEX24XR0";
const serverUrl = ""; // Define server URL once

// Declare globals for SDK objects and key DOM elements
let payments, card, csrfToken;
let originalImage = null;
let canvas, ctx;

// Globals for SVG processing state
let basePolygons = []; // The original, unscaled polygons from the SVG
let currentPolygons = [];
let rasterCutlinePoly = null; // New global for Raster Mode cutline
let cleanCanvasState = null; // To store clean image state (pixels + filters + rotation)
let cachedTempCanvas = null; // To avoid memory leaks in restoreCleanState
let isMetric = false; // To track unit preference
let currentCutline = [];
let currentBounds = null;
let pricingConfig = null;
let inventoryCache = {}; // Cache for Odoo inventory
let isGrayscale = false;
let isSepia = false;
let easterEggUnlocked = false;

// Legend state
let hoveredLegendTab = null;
let selectedLegendTab = null;

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
  cutlineSensitivityValueDisplay,
  lazyLassoSlider,
  lazyLassoValueDisplay;
let cutlineSensitivity = 42; // Default sensitivity
let stickerMaterialSelect,
  stickerResolutionSelect,
  designMarginNote,
  stickerQuantityInput,
  calculatedPriceDisplay;
let paymentStatusContainer,
  ipfsLinkContainer,
  fileInputGlobalRef,
  paymentFormGlobalRef;
let rotateLeftBtnEl,
  rotateRightBtnEl,
  resetBtnEl,
  centerImageBtnEl,
  clearFileBtn,
  resizeInputEl,
  resizeBtnEl,
  grayscaleBtnEl,
  sepiaBtnEl;
let submitPaymentBtn;
let widthDisplayEl, heightDisplayEl;
let canvasPlaceholder;
let canvasLegendContainer;

let currentOrderAmountCents = 0;
let currentProductId = null; // Track if we are in "Product Mode"
let creatorProfitCents = 0; // The markup for the current product
let cutlineOffset = 5; // Default offset

// --- Drag and Center State ---
let imageOffsetX = 0;
let imageOffsetY = 0;
let isDraggingImage = false;
let dragStartX = 0;
let dragStartY = 0;

// Memoization globals for pricing
let lastCalculatedPerimeter = 0;
let lastCalculatedPerimeterCutlineRef = null;

// Helper to get active line interaction state
function getActiveLineId() {
  return hoveredLegendTab || selectedLegendTab;
}

function getConstantLineWidth(basePx = 1.5) {
  if (!canvas || canvas.clientWidth === 0) return basePx;

  // The actual scale factor between the canvas logical pixels and the
  // physical CSS pixels it occupies on the screen.
  const scale = canvas.width / canvas.clientWidth;

  return basePx * scale;
}

function getPolygonsBounds(polygons) {
  if (!polygons || polygons.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Bolt Optimization: Replace nested forEach with standard for-loops.
  // This avoids function call overhead and significantly speeds up bounds calculation
  // without sacrificing readability or relying on complex loop unrolling.
  for (let i = 0, len = polygons.length; i < len; i++) {
    const poly = polygons[i];
    if (!poly) continue;

    for (let j = 0, plen = poly.length; j < plen; j++) {
      const pt = poly[j];

      // Inline case handling, prioritizing standard lowercase keys
      let x = pt.x;
      let y = pt.y;

      if (x === undefined) x = pt.X;
      if (y === undefined) y = pt.Y;

      if (x !== undefined && y !== undefined) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

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
  paymentFormGlobalRef = document.getElementById("payment-form");
  submitPaymentBtn = document.getElementById("submitPaymentBtn");
  canvasPlaceholder = document.getElementById("canvas-placeholder");

  widthDisplayEl = document.getElementById("widthDisplay");
  heightDisplayEl = document.getElementById("heightDisplay");
  canvasLegendContainer = document.getElementById("canvas-legend");

  rotateLeftBtnEl = document.getElementById("rotateLeftBtn");
  rotateRightBtnEl = document.getElementById("rotateRightBtn");
  resetBtnEl = document.getElementById("resetBtn");
  centerImageBtnEl = document.getElementById("centerImageBtn");
  clearFileBtn = document.getElementById("clearFileBtn");
  const resizeSliderEl = document.getElementById("resizeSlider");
  const resizeInputNumberEl = document.getElementById("resizeInput");
  const resizeUnitLabelEl = document.getElementById("resizeUnitLabel");
  grayscaleBtnEl = document.getElementById("grayscaleBtn");
  sepiaBtnEl = document.getElementById("sepiaBtn");
  cutlineOffsetSlider = document.getElementById("cutlineOffsetSlider");
  cutlineOffsetValueDisplay = document.getElementById("cutlineOffsetValue");
  cutlineSensitivitySlider = document.getElementById(
    "cutlineSensitivitySlider",
  );
  cutlineSensitivityValueDisplay = document.getElementById(
    "cutlineSensitivityValue",
  );
  lazyLassoSlider = document.getElementById("lazyLassoSlider");
  lazyLassoValueDisplay = document.getElementById("lazyLassoValue");

  // Fetch CSRF token and pricing info
  await Promise.all([fetchCsrfToken(), fetchPricingInfo(), fetchInventory()]);

  // Initialize Square Payments SDK
  console.log(
    `[CLIENT] Initializing Square SDK with appId: ${appId}, locationId: ${locationId}`,
  );
  let retryCount = 0;
  const maxRetries = 3;
  while (retryCount < maxRetries) {
    try {
      if (!window.Square || !window.Square.payments) {
        throw new Error("Square SDK is not loaded.");
      }
      payments = window.Square.payments(appId, locationId);
      card = await initializeCard(payments);
      break; // Success
    } catch (error) {
      retryCount++;
      console.warn(`[CLIENT] Square SDK init failed (attempt ${retryCount}/${maxRetries}):`, error);
      if (retryCount >= maxRetries) {
        let msg = `Failed to initialize payments: ${error.message}`;
        if (error.message.includes("Network") || typeof Square === "undefined") {
          msg += " (Check your AdBlocker)";
          showAdBlockerWarning();
        }
        showPaymentStatus(msg, "error");
        console.error("[CLIENT] Failed to initialize Square payments SDK:", error);
      } else {
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
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
    stickerResolutionSelect.addEventListener("change", () => {
      calculateAndUpdatePrice();
      if (originalImage || basePolygons.length > 0) {
        // Re-apply current physical size to update logical dimensions for new PPI
        const resizeSliderEl = document.getElementById("resizeSlider");
        if (resizeSliderEl) {
          const latestValue = parseFloat(resizeSliderEl.value);
          if (isMetric) {
            handleStandardResize(latestValue / 25.4);
          } else {
            handleStandardResize(latestValue);
          }
        }
      }
    });
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
  if (centerImageBtnEl) centerImageBtnEl.addEventListener("click", handleCenterImage);
  if (clearFileBtn) clearFileBtn.addEventListener("click", handleClearImage);
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

      let currentLassoRadius = lazyLassoSlider && lazyLassoSlider.value ? parseInt(lazyLassoSlider.value, 10) : 50;

      // If the user goes negative, and they haven't explicitly generated a smart edge
      // yet (meaning they have the default 4-point rectangle), auto-generate it.
      if (cutlineOffset < 0 && rasterCutlinePoly && rasterCutlinePoly.length === 1 && rasterCutlinePoly[0].length === 4 && originalImage) {
        handleGenerateCutline(true); // pass true for skipToast
        return; // handleGenerateCutline will trigger the redraw
      }

      if (!pendingCutlineUpdate) {
        pendingCutlineUpdate = true;
        requestAnimationFrame(() => {
          if (rasterCutlinePoly) {
            // Re-generate cutline for raster (Overlay Mode)
            const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset, currentLassoRadius);
            currentCutline = cutline;
            currentBounds = getPolygonsBounds(cutline);
            calculateAndUpdatePrice();
            drawCanvasDecorations(currentBounds);
          } else if (basePolygons.length > 0) {
            // Re-generate for SVG (Vector Mode)
            const cutline = generateCutLine(currentPolygons, cutlineOffset, currentLassoRadius);
            currentCutline = cutline;
            currentBounds = getPolygonsBounds(cutline);
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
      if (!easterEggUnlocked) {
        if (originalImage && rasterCutlinePoly) {
          handleGenerateCutline();
        }
      }
    });

    // Trigger regeneration only on change (mouse up) to avoid lag
    cutlineSensitivitySlider.addEventListener("change", () => {
      if (originalImage && rasterCutlinePoly) {
        handleGenerateCutline();
      }
    });
  }

  if (lazyLassoSlider) {
    // Update value display immediately
    lazyLassoSlider.addEventListener("input", (e) => {
      if (lazyLassoValueDisplay) {
        lazyLassoValueDisplay.textContent = e.target.value;
      }
      if (!easterEggUnlocked) {
        if (rasterCutlinePoly) {
          const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset, parseInt(e.target.value, 10));
          currentCutline = cutline;
          currentBounds = getPolygonsBounds(cutline);
          calculateAndUpdatePrice();
          drawCanvasDecorations(currentBounds);
        } else if (basePolygons.length > 0) {
          redrawAll();
        }
      }
    });

    // Trigger regeneration only on change (mouse up) to avoid lag
    lazyLassoSlider.addEventListener("change", () => {
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
    // Styling for grabbability
    canvas.style.cursor = "grab";

    // --- Drag and Center Listeners ---
    canvas.addEventListener("mousedown", (e) => {
      // Allow drag if we have an image
      if (!originalImage && basePolygons.length === 0) return;
      isDraggingImage = true;
      dragStartX = e.clientX - imageOffsetX;
      dragStartY = e.clientY - imageOffsetY;
      canvas.style.cursor = "grabbing";
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!isDraggingImage) return;
      imageOffsetX = e.clientX - dragStartX;
      imageOffsetY = e.clientY - dragStartY;
      redrawAll();
    });

    canvas.addEventListener("mouseup", () => {
      isDraggingImage = false;
      canvas.style.cursor = "grab";
    });

    canvas.addEventListener("mouseleave", () => {
      isDraggingImage = false;
      canvas.style.cursor = "grab";
    });
    // --- End Drag Listeners ---

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
      if (e.dataTransfer.getData("application/x-mascot-drag")) {
        const mascotSrc = e.dataTransfer.getData("text/uri-list");
        if (mascotSrc) {
          fetch(mascotSrc)
            .then((res) => res.blob())
            .then((blob) => {
              const file = new File([blob], "Splotch-Mascot.png", {
                type: blob.type,
              });
              loadFileAsImage(file, true);
            })
            .catch((err) => console.error("Failed to load mascot", err));
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
      if (e.dataTransfer.getData("application/x-mascot-drag")) {
        const mascotSrc = e.dataTransfer.getData("text/uri-list");
        if (mascotSrc) {
          fetch(mascotSrc)
            .then((res) => res.blob())
            .then((blob) => {
              const file = new File([blob], "Splotch-Mascot.png", {
                type: blob.type,
              });
              loadFileAsImage(file, true);
            })
            .catch((err) => console.error("Failed to load mascot", err));
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

  // Easter egg listener
  document.addEventListener("easterEggUnlocked", () => {
    if (!easterEggUnlocked) {
      easterEggUnlocked = true;

      // Attempt to find elements again if globals are null
      const grayBtn = document.getElementById("grayscaleBtn");
      const sepBtn = document.getElementById("sepiaBtn");
      const textContainer = document.getElementById("text-editing-controls");
      const cutlineSensitivityContainer = document.getElementById(
        "cutlineSensitivityContainer",
      );
      const lazyLassoContainer = document.getElementById("lazyLassoContainer");
      const generateCutlineBtn = document.getElementById("generateCutlineBtn");

      if (grayBtn) {
        grayBtn.style.display = "block";
      }
      if (sepBtn) {
        sepBtn.style.display = "block";
      }

      if (cutlineSensitivityContainer) {
        cutlineSensitivityContainer.style.display = "flex";
      }
      if (lazyLassoContainer) {
        lazyLassoContainer.style.display = "flex";
      }
      if (generateCutlineBtn) {
        generateCutlineBtn.style.display = "flex";
      }

      const isDisabled = !originalImage && basePolygons.length === 0;
      if (textContainer) {
        if (isDisabled) {
          textContainer.hidden = true;
          textContainer.setAttribute("hidden", "");
          textContainer.style.display = "none";
        } else {
          textContainer.hidden = false;
          textContainer.removeAttribute("hidden");
          textContainer.style.display = "block";
          // Also need to clear any inline style preventing display
          textContainer.style.cssText = textContainer.style.cssText.replace(
            /display:\s*none;?/g,
            "",
          );
        }
      }

      updateEditingButtonsState(isDisabled);

      showNotification("Secret features unlocked! 🎨", "success");
    }
  });

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

  const selectedResolutionId = stickerResolutionSelect.value || "dpi_300";
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
  const tokenResult = await paymentMethod.tokenize(verificationDetails);
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

    // OPTIMIZATION: Sort tiers and discounts once on load to avoid repeated sorting during calculation
    if (pricingConfig.complexity && pricingConfig.complexity.tiers) {
      pricingConfig.complexity.tiers.sort((a, b) =>
        a.thresholdInches === "Infinity"
          ? 1
          : b.thresholdInches === "Infinity"
            ? -1
            : a.thresholdInches - b.thresholdInches,
      );
    }
    if (pricingConfig.quantityDiscounts) {
      pricingConfig.quantityDiscounts.sort((a, b) => b.quantity - a.quantity);
    }

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
      console.log("[CLIENT] Inventory loaded:", inventoryCache);
    }
  } catch (error) {
    console.error("[CLIENT] Failed to load inventory:", error);
  }
}

function checkInventoryStatus(materialId) {
  if (!stickerMaterialSelect) return;

  let warningEl = document.getElementById("material-warning");
  if (!warningEl) {
    warningEl = document.createElement("p");
    warningEl.id = "material-warning";
    warningEl.className = "text-xs text-red-600 font-bold mt-1";
    stickerMaterialSelect.parentNode.appendChild(warningEl);
  }

  const qty = inventoryCache[materialId];

  // Check if quantity is 0 or less (if tracked)
  if (typeof qty === "number" && qty <= 0) {
    warningEl.textContent =
      "⚠️ Low Stock / Out of Stock - Order may be delayed.";
    warningEl.style.display = "block";
  } else {
    warningEl.style.display = "none";
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

    const cutLineFileInput = document.getElementById("cutLineFile");
    if (cutLineFileInput && cutLineFileInput.files[0]) {
      uploadFormData.append("cutLineFile", cutLineFileInput.files[0]);
    } else if (currentCutline && currentCutline.length > 0 && currentBounds) {
      // Automatically generate SVG for cutline if not manually provided
      const svgContent = generateSvgFromCutline(currentCutline, currentBounds);
      if (svgContent) {
        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        uploadFormData.append("cutLineFile", blob, "generated-cutline.svg");
      }
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
      window.location.href = `/orders.html?requires_login=true`;
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
    cutlineOffsetSlider,
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
  const textContainer = document.getElementById("text-editing-controls");
  if (textContainer) {
    if (!easterEggUnlocked) {
      textContainer.hidden = true;
      textContainer.setAttribute("hidden", "");
      textContainer.style.display = "none";
    } else {
      if (disabled) {
        textContainer.hidden = true;
        textContainer.setAttribute("hidden", "");
        textContainer.style.display = "none";
      } else {
        textContainer.hidden = false;
        textContainer.removeAttribute("hidden");
        textContainer.style.display = "block";
        textContainer.style.cssText = textContainer.style.cssText.replace(
          /display:\s*none;?/g,
          "",
        );
      }
    }
  }

  // Update styles for filter buttons based on easterEggUnlocked
  const grayBtn = document.getElementById("grayscaleBtn");
  const sepBtn = document.getElementById("sepiaBtn");
  const cutlineSensitivityContainer = document.getElementById(
    "cutlineSensitivityContainer",
  );
  const lazyLassoContainer = document.getElementById("lazyLassoContainer");
  const generateCutlineBtn = document.getElementById("generateCutlineBtn");

  if (!easterEggUnlocked) {
    if (grayBtn) grayBtn.style.display = "none";
    if (sepBtn) sepBtn.style.display = "none";
    if (cutlineSensitivityContainer)
      cutlineSensitivityContainer.style.display = "none";
    if (lazyLassoContainer) lazyLassoContainer.style.display = "none";
    if (generateCutlineBtn) generateCutlineBtn.style.display = "none";
  } else {
    if (grayBtn) {
      grayBtn.style.display = disabled ? "none" : "block";
    }
    if (sepBtn) {
      sepBtn.style.display = disabled ? "none" : "block";
    }
    if (cutlineSensitivityContainer) {
      cutlineSensitivityContainer.style.display = disabled ? "none" : "flex";
    }
    if (lazyLassoContainer) {
      lazyLassoContainer.style.display = disabled ? "none" : "flex";
    }
    if (generateCutlineBtn) {
      generateCutlineBtn.style.display = disabled ? "none" : "flex";
    }
  }
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

  // Bolt Fix: True-to-Size Preview
  // Calculate display size based on the selected PPI (or default to 96 if not loaded/selected)
  let ppi = 96;
  if (pricingConfig && stickerResolutionSelect) {
    const selectedRes = pricingConfig.resolutions.find(
      (r) => r.id === (stickerResolutionSelect.value || "dpi_300"),
    );
    if (selectedRes) {
      ppi = selectedRes.ppi;
    }
  }

  // logicalWidth is in "Image Pixels".
  // Physical Inches = logicalWidth / ppi

  // Standard display assumption: CSS inches are ~96 pixels per inch
  // However, this means if physical size is 3 inches, we'd render it at 3 * 96 = 288px on screen,
  // which might be tiny or very large depending on physical monitor DPI.
  // Instead, to ensure it is true to life, we can detect screen real DPI if possible,
  // but CSS assumes 1in = 96px regardless of actual device resolution.
  // We'll stick to CSS inches because that's standard for web layouts.
  const cssWidth = (logicalWidth / ppi) * 96;
  const cssHeight = (logicalHeight / ppi) * 96;

  // Update CSS size to match calculated display size exactly, true to life.
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  // Specifically remove object-fit/maxWidth to ensure visual scaling changes are absolute
  canvas.style.maxWidth = "none";
  canvas.style.maxHeight = "none";
  canvas.style.objectFit = "fill";
}

function saveCleanState() {
  if (!canvas || !ctx) return;
  cleanCanvasState = ctx.getImageData(0, 0, canvas.width, canvas.height);
  cachedTempCanvas = null; // Invalidate cache
}

function restoreCleanState(dragOffset = { x: 0, y: 0 }) {
  if (!canvas || !ctx || !cleanCanvasState) return;

  if (!cachedTempCanvas || cachedTempCanvas.width !== cleanCanvasState.width || cachedTempCanvas.height !== cleanCanvasState.height) {
    cachedTempCanvas = document.createElement("canvas");
    cachedTempCanvas.width = cleanCanvasState.width;
    cachedTempCanvas.height = cleanCanvasState.height;
    cachedTempCanvas.getContext("2d").putImageData(cleanCanvasState, 0, 0);
  }
  const tempCanvas = cachedTempCanvas;

  // If we are in raster mode and have current bounds that push left/top negative,
  // we need to offset the clean state onto the potentially larger canvas.
  let drawOffset = { x: 0, y: 0 };
  if (
    basePolygons.length === 0 &&
    currentBounds &&
    (currentBounds.left < 0 || currentBounds.top < 0)
  ) {
    drawOffset = {
      x: -currentBounds.left + 20,
      y: -currentBounds.top + 20,
    };
  }

  ctx.save();
  ctx.translate(dragOffset.x, dragOffset.y);
  ctx.drawImage(tempCanvas, drawOffset.x, drawOffset.y);
  ctx.restore();
}

// --- Image Loading and Editing Functions ---
function handleFileChange(event) {
  const file = event.target.files[0];
  if (file) {
    loadFileAsImage(file);
  }
}

function loadFileAsImage(file, isMascot = false) {
  if (file && fileInputGlobalRef) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInputGlobalRef.files = dataTransfer.files;
  }
  if (!file) return;

  const reader = new FileReader();

  // Handle SVGs differently from other images
  if (file.type === "image/svg+xml") {
    // Reset raster image state
    originalImage = null;
    reader.onload = (e) => {
      handleSvgUpload(e.target.result);
    };
    reader.onerror = () => showNotification("Error reading SVG file.", "error");
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
        if (clearFileBtn) clearFileBtn.classList.remove("hidden");
        showNotification("Image loaded successfully.", "success");
        let newWidth = img.width,
          newHeight = img.height;
        if (canvas && ctx) {
          setCanvasSize(newWidth, newHeight);
          ctx.clearRect(0, 0, newWidth, newHeight);
          ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

          saveCleanState(); // Save state before decorations

          // Bolt Fix: Default to 2 inches on import (2.8 for Mascot)
          if (pricingConfig) {
            const defaultSize = isMascot ? 2.8 : 2;
            handleStandardResize(defaultSize);

            // Update Slider UI
            const resizeSliderEl = document.getElementById("resizeSlider");
            const resizeInputNumberEl = document.getElementById("resizeInput");
            const resizeUnitLabelEl =
              document.getElementById("resizeUnitLabel");

            if (resizeSliderEl && resizeInputNumberEl) {
              const val = isMetric ? defaultSize * 25.4 : defaultSize;
              resizeSliderEl.value = val;
              resizeInputNumberEl.value = val.toFixed(1);
              if (resizeUnitLabelEl)
                resizeUnitLabelEl.textContent = isMetric ? "mm" : "in";
            }
          }

          // Generate cutline based on image transparency
          const currentImageData = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const dpr = window.devicePixelRatio || 1;
          const logicalWidth = canvas.width / dpr;
          const logicalHeight = canvas.height / dpr;

          if (imageHasTransparentBorder(currentImageData)) {
            // Auto-generate smart cutline for transparent images
            handleGenerateCutline(true); // Pass true to skip confirmation prompt
          } else {
            // Setup a rectangular rasterCutlinePoly for non-transparent images
            rasterCutlinePoly = [
              [
                { x: 0, y: 0 },
                { x: logicalWidth, y: 0 },
                { x: logicalWidth, y: logicalHeight },
                { x: 0, y: logicalHeight },
              ],
            ];

            // Set slider to 10 (1mm) offset
            cutlineOffset = 5;
            if (cutlineOffsetSlider) {
              cutlineOffsetSlider.value = 5;
            }
            if (cutlineOffsetValueDisplay) {
              cutlineOffsetValueDisplay.textContent = cutlineOffset;
            }

            const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
            currentCutline = cutline;
            currentBounds = getPolygonsBounds(cutline);

            calculateAndUpdatePrice();
            drawCanvasDecorations(currentBounds);
          }
          currentPolygons = []; // Clear any previous SVG data

          // Show the legend tabs since an image is loaded
          renderLegend();
        }
      };
      img.onerror = () =>
        showNotification("Error loading image data.", "error");
      img.src = reader.result;
    };
    reader.onerror = () => showNotification("Error reading file.", "error");
    reader.readAsDataURL(file);
  } else {
    showNotification(
      "Invalid file type. Please select an image or SVG file.",
      "error",
    );
  }
}

function redrawAll() {
  if (currentPolygons.length === 0) {
    // Handle raster image redrawing if necessary
    if (originalImage) {
        // Redraw decorations using the current offset. The base image is handled inside drawCanvasDecorations via restoreCleanState
        const offset = { x: imageOffsetX, y: imageOffsetY };
        ctx.clearRect(0, 0, canvas.width, canvas.height); // wipe it
        drawCanvasDecorations(currentBounds, offset);
    }
    return;
  }

  const lazyLassoSlider = document.getElementById("lazyLassoSlider");
  const currentLassoRadius = lazyLassoSlider && lazyLassoSlider.value ? parseInt(lazyLassoSlider.value, 10) : 50;

  // Generate the cutline from the current state of the polygons
  const cutline = generateCutLine(currentPolygons, cutlineOffset, currentLassoRadius); // Use dynamic offset

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
    x: -currentBounds.left + 20 + imageOffsetX,
    y: -currentBounds.top + 20 + imageOffsetY,
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

    // Initial drawing
    redrawAll();

    // Bolt Fix: Default to 2 inches on import
    if (pricingConfig) {
      const defaultSize = 2;

      // Update Slider UI BEFORE resizing so state matches
      const resizeSliderEl = document.getElementById("resizeSlider");
      const resizeInputNumberEl = document.getElementById("resizeInput");
      const resizeUnitLabelEl = document.getElementById("resizeUnitLabel");

      if (resizeSliderEl && resizeInputNumberEl) {
        const val = isMetric ? defaultSize * 25.4 : defaultSize;
        resizeSliderEl.value = val;
        resizeInputNumberEl.value = val.toFixed(1);
        if (resizeUnitLabelEl)
          resizeUnitLabelEl.textContent = isMetric ? "mm" : "in";
      }

      handleStandardResize(defaultSize);

      // Ensure price is calculated after all initializations
      calculateAndUpdatePrice();
    }

    if (clearFileBtn) clearFileBtn.classList.remove("hidden");
    showNotification("SVG processed and cutline generated.", "success");
    updateEditingButtonsState(false); // Enable editing buttons

    // Show legend since SVG is loaded
    renderLegend();
  } catch (error) {
    showNotification(`SVG Processing Error: ${error.message}`, "error");
    console.error(error);
  }
}

const scaledPolyCache = new WeakMap();

function generateCutLine(polygons, rawOffset, rawLazyRadius = 0) {
  const scale = 100; // Scale for integer precision

  // Determine current PPI from UI state to convert real-world values to image pixels
  let ppi = 300; // Default fallback
  if (
    typeof pricingConfig !== "undefined" &&
    pricingConfig &&
    typeof stickerResolutionSelect !== "undefined" &&
    stickerResolutionSelect
  ) {
    const selectedRes = pricingConfig.resolutions.find(
      (r) => r.id === (stickerResolutionSelect.value || "dpi_300"),
    );
    if (selectedRes) {
      ppi = selectedRes.ppi;
    }
  }

  // Convert raw values (which the slider outputs, presumably representing something like 0.1mm increments)
  // Let's assume the slider values represent 0.1mm (so slider value 10 = 1mm).
  // Then physical offset in mm is (sliderValue / 10).
  const offsetMm = rawOffset / 10;
  const lazyRadiusMm = rawLazyRadius / 10;

  // Convert mm to logical pixels using the current PPI
  const offsetPx = (offsetMm / 25.4) * ppi;
  const lazyRadiusPx = (lazyRadiusMm / 25.4) * ppi;

  let scaledPolygons;
  // Bolt Optimization: Memoize scaled polygons to avoid O(N) allocation on every slider update.
  // Using WeakMap avoids memory leaks if the polygons array is garbage collected.
  if (scaledPolyCache.has(polygons)) {
    scaledPolygons = scaledPolyCache.get(polygons);
  } else {
    // Bolt Optimization: Replace nested .map() with pre-allocated arrays and for-loops
    const newScaledPolygons = new Array(polygons.length);
    for (let i = 0; i < polygons.length; i++) {
      const p = polygons[i];
      const newPoly = new Array(p.length);
      for (let j = 0; j < p.length; j++) {
        const point = p[j];
        newPoly[j] = {
          X: Math.round(point.x * scale),
          Y: Math.round(point.y * scale),
        };
      }
      newScaledPolygons[i] = newPoly;
    }
    scaledPolygons = newScaledPolygons;
    scaledPolyCache.set(polygons, scaledPolygons);
  }

  let final_paths;
  const joinType = offsetPx <= 0 ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound;

  if (lazyRadiusPx > 0) {
    // 1. Dilate to bridge gaps
    const co1 = new ClipperLib.ClipperOffset();
    const expanded_paths = new ClipperLib.Paths();
    co1.AddPaths(
      scaledPolygons,
      ClipperLib.JoinType.jtRound,
      ClipperLib.EndType.etClosedPolygon,
    );
    co1.Execute(expanded_paths, Math.round(lazyRadiusPx * scale));

    // 2. Erode to return to the original boundary but with closed gaps
    const co2 = new ClipperLib.ClipperOffset();
    const shrunk_paths = new ClipperLib.Paths();
    co2.AddPaths(
      expanded_paths,
      ClipperLib.JoinType.jtRound,
      ClipperLib.EndType.etClosedPolygon,
    );
    co2.Execute(shrunk_paths, Math.round(-lazyRadiusPx * scale));

    // 3. Apply the actual requested cutline offset
    const co3 = new ClipperLib.ClipperOffset(10, 0.25);
    final_paths = new ClipperLib.Paths();
    co3.AddPaths(
      shrunk_paths,
      joinType,
      ClipperLib.EndType.etClosedPolygon,
    );
    co3.Execute(final_paths, Math.round(offsetPx * scale));
  } else {
    // Normal single-pass offset
    const co = new ClipperLib.ClipperOffset(10, 0.25);
    final_paths = new ClipperLib.Paths();
    co.AddPaths(
      scaledPolygons,
      joinType,
      ClipperLib.EndType.etClosedPolygon,
    );
    co.Execute(final_paths, Math.round(offsetPx * scale));
  }

  // Scale back down
  // Bolt Optimization: Replace nested .map() with pre-allocated arrays and for-loops
  const cutline = new Array(final_paths.length);
  for (let i = 0; i < final_paths.length; i++) {
    const p = final_paths[i];
    const newPoly = new Array(p.length);
    for (let j = 0; j < p.length; j++) {
      const point = p[j];
      newPoly[j] = { x: point.X / scale, y: point.Y / scale };
    }
    cutline[i] = newPoly;
  }

  return cutline;
}

function drawPolygonsToCanvas(
  polygons,
  style,
  offset = { x: 0, y: 0 },
  stroke = false,
) {
  if (!ctx || polygons.length === 0) return;

  ctx.save();

  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;

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
    // Determine active state for legend highlighting
    const activeLineId = getActiveLineId();
    const isCutlineActive = activeLineId === "cutline";
    const isOtherActive = activeLineId && !isCutlineActive;

    ctx.strokeStyle = style;

    // Constant hairline width
    const baseLineWidth = getConstantLineWidth(isCutlineActive ? 3.0 : 1.5);
    ctx.lineWidth = baseLineWidth;

    if (isOtherActive) {
      ctx.globalAlpha = 0.3; // Dim when another line is selected
    } else {
      ctx.globalAlpha = 1.0;
    }

    if (isCutlineActive) {
      ctx.setLineDash([]); // Solid when highlighted
    } else {
      ctx.setLineDash([getConstantLineWidth(4), getConstantLineWidth(4)]); // Make the cutline dashed
    }

    ctx.stroke();
    ctx.setLineDash([]); // Reset for other drawing operations
  } else {
    ctx.fillStyle = style;
    ctx.fill();
  }
  ctx.restore();
}

function drawCanvasDecorations(bounds, offset = { x: 0, y: 0 }) {
  if (!bounds) return;

  let drawOffset = offset;

  // In Raster Mode (where basePolygons is empty), we need to handle canvas resizing
  // and restoring the clean image first to wipe old decorations.
  if (basePolygons.length === 0) {
    if (bounds.left < 0 || bounds.top < 0) {
      const logicalWidth = bounds.right - bounds.left + 40; // Add padding
      const logicalHeight = bounds.bottom - bounds.top + 40;
      setCanvasSize(logicalWidth, logicalHeight);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      drawOffset = {
        x: -bounds.left + 20,
        y: -bounds.top + 20,
      };
    } else if (cleanCanvasState) {
      // Ensure canvas is at least original size
      const dpr = window.devicePixelRatio || 1;
      // We must compare against the display/logical dimensions, not the raw pixel dimensions
      const logicalOrigW = cleanCanvasState.width / dpr;
      if (canvas && canvas.width !== cleanCanvasState.width) {
        // Need to set it back to original state if we shrank the cutline back
        setCanvasSize(logicalOrigW, cleanCanvasState.height / dpr);
        ctx.clearRect(0, 0, logicalOrigW, cleanCanvasState.height / dpr);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    if (cleanCanvasState) restoreCleanState({ x: imageOffsetX, y: imageOffsetY });
  }

  drawBoundingBox(bounds, drawOffset);
  drawSizeIndicator(bounds, drawOffset);
  drawRuler(bounds, drawOffset);

  // In Raster Mode, we draw the cutline overlay manually
  if (
    basePolygons.length === 0 &&
    currentCutline &&
    currentCutline.length > 0
  ) {
    drawPolygonsToCanvas(currentCutline, "red", drawOffset, true);
  }
}

function drawBoundingBox(bounds, offset = { x: 0, y: 0 }) {
  if (!ctx || !bounds || !pricingConfig) {
    return;
  }

  ctx.save();

  const activeLineId = getActiveLineId();
  const isBoxActive = activeLineId === "box";
  const isOtherActive = activeLineId && !isBoxActive;

  // The user wanted a grey box with 1-inch dashes for pricing.
  // The previous implementation calculated a dash length from PPI, which was often
  // too large to be visible on smaller images. A fixed dash pattern is more reliable.

  // Set color to grey as requested.
  ctx.strokeStyle = "rgba(128, 128, 128, 0.9)"; // A strong, visible grey

  // Constant hairline width
  const baseLineWidth = getConstantLineWidth(isBoxActive ? 3.0 : 2.0);
  ctx.lineWidth = baseLineWidth;

  if (isOtherActive) {
    ctx.globalAlpha = 0.3;
  } else {
    ctx.globalAlpha = 1.0;
  }

  // Use a fixed dash pattern that is visible at most scales.
  if (isBoxActive) {
    ctx.setLineDash([]); // Solid when active
  } else {
    ctx.setLineDash([getConstantLineWidth(10), getConstantLineWidth(5)]);
  }

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
      (r) => r.id === (stickerResolutionSelect.value || "dpi_300"),
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

let legendInitialized = false;

function renderLegend() {
  if (!canvasLegendContainer) return;

  // Only show if there's an image or svg loaded
  if (!originalImage && basePolygons.length === 0) {
    canvasLegendContainer.style.display = "none";
    return;
  }

  canvasLegendContainer.style.display = "flex";

  const tabs = [
    {
      id: "cutline",
      label: "Cutline",
      color: "red",
      borderColor: "#ef4444",
      bgColor: "#fee2e2",
    },
    {
      id: "box",
      label: "Bounding Box",
      color: "grey",
      borderColor: "#9ca3af",
      bgColor: "#f3f4f6",
    },
  ];

  if (!legendInitialized) {
    canvasLegendContainer.innerHTML = ""; // Clear once on init

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `legend-tab-${tab.id}`;
      btn.className = `px-3 py-1 text-xs font-semibold rounded-t-lg transition-colors border-2 border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`;

      // Default style
      btn.style.color = tab.color;
      btn.style.borderColor = tab.borderColor;
      btn.style.fontFamily = "var(--font-baumans)";
      btn.textContent = tab.label;

      // Interactivity
      btn.addEventListener("mouseenter", () => {
        hoveredLegendTab = tab.id;
        updateLegendStyles();
        redrawAllForHighlight();
      });

      btn.addEventListener("mouseleave", () => {
        if (hoveredLegendTab === tab.id) {
          hoveredLegendTab = null;
          updateLegendStyles();
          redrawAllForHighlight();
        }
      });

      btn.addEventListener("click", () => {
        if (selectedLegendTab === tab.id) {
          selectedLegendTab = null; // Toggle off
        } else {
          selectedLegendTab = tab.id;
        }
        updateLegendStyles();
        redrawAllForHighlight();
      });

      canvasLegendContainer.appendChild(btn);
    });

    legendInitialized = true;
  }

  updateLegendStyles();
}

function updateLegendStyles() {
  if (!canvasLegendContainer) return;
  const tabs = [
    { id: "cutline", bgColor: "#fee2e2" },
    { id: "box", bgColor: "#f3f4f6" },
  ];

  tabs.forEach((tab) => {
    const btn = document.getElementById(`legend-tab-${tab.id}`);
    if (btn) {
      const isActive = getActiveLineId() === tab.id;
      if (isActive) {
        btn.style.backgroundColor = tab.bgColor;
      } else {
        btn.style.backgroundColor = "transparent";
      }
    }
  });
}

function redrawAllForHighlight() {
  // A lightweight redraw to just update the canvas decorations when hover state changes.
  if (basePolygons.length > 0) {
    // For SVG Vector Mode
    const drawOffset = {
      x: -currentBounds.left + 20,
      y: -currentBounds.top + 20,
    };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPolygonsToCanvas(currentPolygons, "black", drawOffset);
    drawPolygonsToCanvas(currentCutline, "red", drawOffset, true);
    drawCanvasDecorations(currentBounds, drawOffset);
  } else if (originalImage) {
    // For Raster Mode, we can just call drawCanvasDecorations which first restores the clean state
    drawCanvasDecorations(currentBounds);
  }
}

function drawRuler(bounds, offset = { x: 0, y: 0 }) {
  if (!ctx || !bounds || !pricingConfig || !stickerResolutionSelect) return;
  const ppi =
    pricingConfig.resolutions.find(
      (r) => r.id === (stickerResolutionSelect.value || "dpi_300"),
    )?.ppi || 96;
  drawCanvasRuler(ctx, bounds, offset, ppi, isMetric);
}

function handleAddText() {
  if (!canvas || !ctx || !originalImage) {
    showNotification("Please load an image before adding text.", "error");
    return;
  }
  const text = textInput.value;
  const size = parseInt(textSizeInput.value, 10);
  const color = textColorInput.value;
  const font = textFontFamilySelect.value;
  if (!text.trim() || isNaN(size) || size <= 0) {
    showNotification("Please enter valid text and size.", "error");
    return;
  }
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, (canvas.width / 2) + imageOffsetX, (canvas.height / 2) + imageOffsetY);
  showNotification(`Text "${text}" added.`, "success");
}

function handleClearImage() {
  if (!confirm("Are you sure you want to remove the image?")) return;

  originalImage = null;
  basePolygons = [];
  currentPolygons = [];
  rasterCutlinePoly = null;
  currentCutline = [];
  currentBounds = null;
  cleanCanvasState = null;
  cachedTempCanvas = null;

  if (fileInputGlobalRef) fileInputGlobalRef.value = "";
  if (canvas && ctx) {
    // Reset to default size (matches HTML)
    setCanvasSize(500, 400);
    // Clearing 0,0 to width,height works because setCanvasSize sets transform
    ctx.clearRect(0, 0, 500, 400);
  }

  updateEditingButtonsState(true);
  calculateAndUpdatePrice();

  // Hide legend on clear
  renderLegend();

  if (clearFileBtn) clearFileBtn.classList.add("hidden");
  if (fileInputGlobalRef) fileInputGlobalRef.focus();
  showNotification("Image removed.", "info");
}

function handleCenterImage() {
  if (imageOffsetX === 0 && imageOffsetY === 0) {
    showNotification("Image is already centered.", "info");
    return;
  }
  imageOffsetX = 0;
  imageOffsetY = 0;
  redrawAll();
}

function handleResetImage() {
  if (!originalImage && basePolygons.length === 0) {
    showNotification("Nothing to reset.", "info");
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
    imageOffsetX = 0; // Reset offset
    imageOffsetY = 0; // Reset offset

    let newWidth = originalImage.width,
      newHeight = originalImage.height;

    if (canvas && ctx) {
      setCanvasSize(newWidth, newHeight);
      ctx.clearRect(0, 0, newWidth, newHeight);
      ctx.drawImage(originalImage, 0, 0, newWidth, newHeight);

      saveCleanState(); // Save state before decorations

      // Generate cutline based on image transparency
      const currentImageData = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = canvas.width / dpr;
      const logicalHeight = canvas.height / dpr;

      if (imageHasTransparentBorder(currentImageData)) {
        handleGenerateCutline(true);
      } else {
        rasterCutlinePoly = [
          [
            { x: 0, y: 0 },
            { x: logicalWidth, y: 0 },
            { x: logicalWidth, y: logicalHeight },
            { x: 0, y: logicalHeight },
          ],
        ];

        cutlineOffset = 5;
        if (cutlineOffsetSlider) {
          cutlineOffsetSlider.value = 5;
        }
        if (cutlineOffsetValueDisplay) {
          cutlineOffsetValueDisplay.textContent = cutlineOffset;
        }

        const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
        currentCutline = cutline;
        currentBounds = getPolygonsBounds(cutline);
      }

      updateFilterButtonVisuals();

      // Reset Slider
      const resizeSliderEl = document.getElementById("resizeSlider");
      const resizeInputNumberEl = document.getElementById("resizeInput");
      const resizeUnitLabelEl = document.getElementById("resizeUnitLabel");
      if (resizeSliderEl) {
        if (pricingConfig && stickerResolutionSelect) {
          const selectedResolution = pricingConfig.resolutions.find(
            (r) => r.id === (stickerResolutionSelect.value || "dpi_300"),
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
      showNotification("Image reset to original.", "success");
    }
  } else if (basePolygons.length > 0) {
    // SVG Reset
    currentPolygons = basePolygons;
    redrawAll();
    showNotification("Image reset to original.", "success");
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

    // Bolt Optimization: Replace nested .map() with pre-allocated arrays and standard for-loops.
    // This eliminates closure allocation overhead and reduces GC pressure in hot requestAnimationFrame paths.
    const newPolygons = new Array(currentPolygons.length);
    for (let i = 0; i < currentPolygons.length; i++) {
      const poly = currentPolygons[i];
      const newPoly = new Array(poly.length);
      for (let j = 0; j < poly.length; j++) {
        const point = poly[j];
        const translatedX = point.x - centerX;
        const translatedY = point.y - centerY;
        const rotatedX = translatedX * cos - translatedY * sin;
        const rotatedY = translatedX * sin + translatedY * cos;
        newPoly[j] = { x: rotatedX + centerX, y: rotatedY + centerY };
      }
      newPolygons[i] = newPoly;
    }
    currentPolygons = newPolygons;
    redrawAll();
  } else if (originalImage) {
    // Use the current canvas dimensions, which represent the scaled image size
    const dpr = window.devicePixelRatio || 1;
    let w = canvas.width;
    let h = canvas.height;
    let sourceCanvas = canvas;

    if (cleanCanvasState) {
      if (!cachedTempCanvas || cachedTempCanvas.width !== cleanCanvasState.width || cachedTempCanvas.height !== cleanCanvasState.height) {
        cachedTempCanvas = document.createElement("canvas");
        cachedTempCanvas.width = cleanCanvasState.width;
        cachedTempCanvas.height = cleanCanvasState.height;
        cachedTempCanvas.getContext("2d").putImageData(cleanCanvasState, 0, 0);
      }
      sourceCanvas = cachedTempCanvas;
      w = cleanCanvasState.width;
      h = cleanCanvasState.height;
    }

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
    tempCtx.drawImage(sourceCanvas, -w / 2, -h / 2);

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
      const oldCenterX = w / dpr / 2;
      const oldCenterY = h / dpr / 2;
      const newCenterX = newW / dpr / 2;
      const newCenterY = newH / dpr / 2;

      // Bolt Optimization: Replace nested .map() with pre-allocated arrays and standard for-loops.
      // This eliminates closure allocation overhead and reduces GC pressure in hot requestAnimationFrame paths.
      const newRasterCutlinePoly = new Array(rasterCutlinePoly.length);
      for (let i = 0; i < rasterCutlinePoly.length; i++) {
        const poly = rasterCutlinePoly[i];
        const newPoly = new Array(poly.length);
        for (let j = 0; j < poly.length; j++) {
          const p = poly[j];
          const tx = p.x - oldCenterX;
          const ty = p.y - oldCenterY;
          const rx = tx * cos - ty * sin;
          const ry = tx * sin + ty * cos;
          newPoly[j] = { x: rx + newCenterX, y: ry + newCenterY };
        }
        newRasterCutlinePoly[i] = newPoly;
      }
      rasterCutlinePoly = newRasterCutlinePoly;

      // Regenerate currentCutline from rotated poly
      const lazyLassoSlider = document.getElementById("lazyLassoSlider");
      const currentLassoRadius = lazyLassoSlider && lazyLassoSlider.value ? parseInt(lazyLassoSlider.value, 10) : 50;
      const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset, currentLassoRadius);
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
      currentCutline = [
        [
          { x: 0, y: 0 },
          { x: newW, y: 0 },
          { x: newW, y: newH },
          { x: 0, y: newH },
        ],
      ];
    }

    calculateAndUpdatePrice();
    drawCanvasDecorations(currentBounds);
  }
}

function redrawOriginalImageWithFilters() {
  if (!originalImage || !ctx || !canvas) return;

  // Bolt Optimization: Use hardware-accelerated Canvas filters via helper
  // We draw without offset here so the clean state is saved at the origin
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
    // We must pass the current drag offset down to the drawing functions,
    // but the decorations function handles the drag offset for the image,
    // so we can just call it to rebuild the scene correctly
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    showNotification("Please load an image first.", "error");
    return;
  }

  const resolutionId = stickerResolutionSelect.value || "dpi_300";
  const selectedResolution = pricingConfig.resolutions.find(
    (r) => r.id === resolutionId,
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

  // NOTE: If scale is 1, maybe it already scaled but currentMaxWidthPixels
  // was taken from the raw image. If this gets called multiple times, we're
  // ALWAYS multiplying originalImage.width by `scale` in the raster logic below:
  // const newWidth = originalImage.width * scale;
  // This is actually CORRECT because currentMaxWidthPixels is also derived from
  // originalImage.width. So `scale = targetPixels / originalImage.width`.
  // Therefore `newWidth = originalImage.width * (targetPixels / originalImage.width)`
  // which equals targetPixels.

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
    // Bolt Optimization: Replace nested .map() with pre-allocated arrays to avoid dynamic array resizing overhead.
    const newPolygons = new Array(basePolygons.length);
    for (let i = 0; i < basePolygons.length; i++) {
      const poly = basePolygons[i];
      const newPoly = new Array(poly.length);
      for (let j = 0; j < poly.length; j++) {
        const point = poly[j];
        newPoly[j] = { x: point.x * scale, y: point.y * scale };
      }
      newPolygons[i] = newPoly;
    }
    currentPolygons = newPolygons;
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

        // Bolt Optimization: Use pre-allocated arrays and for loops instead of nested .map()
        const newRasterCutlinePoly = new Array(rasterCutlinePoly.length);
        for (let i = 0; i < rasterCutlinePoly.length; i++) {
          const poly = rasterCutlinePoly[i];
          const newPoly = new Array(poly.length);
          for (let j = 0; j < poly.length; j++) {
            const p = poly[j];
            newPoly[j] = { x: p.x * scaleX, y: p.y * scaleY };
          }
          newRasterCutlinePoly[i] = newPoly;
        }
        rasterCutlinePoly = newRasterCutlinePoly;

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

function handleGenerateCutline(skipPrompt = false) {
  if (!canvas || !ctx || !originalImage) {
    showNotification(
      "Smart cutline requires a raster image (PNG, JPG). Please upload one.",
      "error",
    );
    return;
  }

  // --- Feedforward Check ---
  // Pass the imageData to the function
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  showNotification("Generating smart cutline...", "info");

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

  const lazyLassoSlider = document.getElementById("lazyLassoSlider");
  const lazyLassoRadius = lazyLassoSlider
    ? parseInt(lazyLassoSlider.value, 10)
    : 50;

  // Use a timeout to allow the UI to update before the heavy computation
  setTimeout(() => {
    try {
      const dpr = window.devicePixelRatio || 1;
      const logicalCanvasWidth = canvas.width / dpr;
      const logicalCanvasHeight = canvas.height / dpr;

      // --- Performance Optimization: Downscale before tracing ---
      const maxDim = 500;
      const scaleFactor = Math.min(1, maxDim / Math.max(logicalCanvasWidth, logicalCanvasHeight));
      const scaledWidth = Math.max(1, Math.round(logicalCanvasWidth * scaleFactor));
      const scaledHeight = Math.max(1, Math.round(logicalCanvasHeight * scaleFactor));

      let scaledImageData;
      if (scaleFactor < 1 || dpr !== 1) {
        const tempCanvas1 = document.createElement('canvas');
        tempCanvas1.width = canvas.width;
        tempCanvas1.height = canvas.height;
        const tempCtx1 = tempCanvas1.getContext('2d');
        if (cleanCanvasState && cleanCanvasState.width === canvas.width && cleanCanvasState.height === canvas.height) {
          tempCtx1.putImageData(cleanCanvasState, 0, 0);
        } else {
          tempCtx1.drawImage(canvas, 0, 0);
        }

        const tempCanvas2 = document.createElement('canvas');
        tempCanvas2.width = scaledWidth;
        tempCanvas2.height = scaledHeight;
        const tempCtx2 = tempCanvas2.getContext('2d');
        tempCtx2.drawImage(tempCanvas1, 0, 0, tempCanvas1.width, tempCanvas1.height, 0, 0, scaledWidth, scaledHeight);
        scaledImageData = tempCtx2.getImageData(0, 0, scaledWidth, scaledHeight);
      } else {
        if (cleanCanvasState && cleanCanvasState.width === canvas.width && cleanCanvasState.height === canvas.height) {
          scaledImageData = cleanCanvasState;
        } else {
          scaledImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      }

      let contours = traceContours(scaledImageData, cutlineSensitivity);
      if (contours) {
         contours = contours.map(c => c.map(p => ({
           x: p.x / scaleFactor,
           y: p.y / scaleFactor
         })));
      }

      if (!contours || contours.length === 0) {
        throw new Error(
          "Could not find any distinct contour. Image may be empty.",
        );
      }

      // Filter contours to remove noise (e.g. area < 100 pixels)
      // Bolt Optimization: Use a dynamic threshold based on image size to filter noise spots (islands)
      const imageArea = canvas.width * canvas.height;
      const minIslandArea = Math.max(100, imageArea * 0.0001); // At least 100px, or 0.01% of image
      // Bolt Optimization: Simplify FIRST to reduce points for topological checks (isPointInPolygon)
      // This changes O(N*M) check to O(N*m) where m << M.
      let significantContours = contours
        .filter((c) => getPolygonArea(c) > minIslandArea)
        .map((c) => simplifyPolygon(c, 0.5)); // Epsilon of 0.5 pixels

      // Suppress "island cuts" (internal holes) that are larger than 2mm.
      // Constraint: "we can have internal cuts, but they should be less than 2mm"
      // Interpretation: Keep internal cuts <= 2mm. Remove internal cuts > 2mm.
      if (significantContours.length > 0) {
        const selectedResolutionId =
          stickerResolutionSelect && stickerResolutionSelect.value
            ? stickerResolutionSelect.value
            : "dpi_300";
        const selectedResolution =
          pricingConfig && pricingConfig.resolutions
            ? pricingConfig.resolutions.find(
                (r) => r.id === selectedResolutionId,
              )
            : null;

        const ppi = selectedResolution ? selectedResolution.ppi : 300;
        // Calculate 2mm in pixels for max hole size
        let maxAllowedHoleSize = (2 / 25.4) * ppi;
        // Calculate 0.5mm in pixels for min hole size (noise floor)
        const minAllowedHoleSize = (0.5 / 25.4) * ppi;

        if (lazyLassoRadius >= 50) {
            maxAllowedHoleSize = -1;
        }

        significantContours = filterInternalContours(
          significantContours,
          maxAllowedHoleSize,
          minAllowedHoleSize,
        );
      }

      if (significantContours.length === 0) {
        throw new Error(
          "No significant shapes found. Image may be too noisy or empty.",
        );
      }

      const scale = 100;
      const finalContours = [];

      significantContours.forEach((contour) => {
        // Bolt Optimization: Apply smoothing to round sharp corners ("surface energy minimization")
        // 2 iterations of Chaikin's algorithm gives nice rounded corners without adding too many vertices
        // Note: contour is already simplified.
        const smoothedContour = smoothPolygon(contour, 2);

        // Clean the polygon to remove self-intersections and other issues before offsetting.
        // This requires scaling up for Clipper's integer math.
        // Bolt Optimization: Pre-allocate array and use for-loop instead of .map() to reduce GC pressure
        const scaledPoly = new Array(smoothedContour.length);
        for (let j = 0; j < smoothedContour.length; j++) {
          const p = smoothedContour[j];
          scaledPoly[j] = { X: p.x * scale, Y: p.y * scale };
        }
        const cleanedScaledPoly = ClipperLib.Clipper.CleanPolygon(
          scaledPoly,
          0.1,
        );

        // Add validation to ensure we have a usable polygon AFTER cleaning
        if (cleanedScaledPoly && cleanedScaledPoly.length >= 3) {
          // Bolt Optimization: Pre-allocate array and use for-loop instead of .map()
          const newPoly = new Array(cleanedScaledPoly.length);
          for (let j = 0; j < cleanedScaledPoly.length; j++) {
            const p = cleanedScaledPoly[j];
            newPoly[j] = { x: p.X / scale, y: p.Y / scale };
          }
          finalContours.push(newPoly);
        }
      });

      if (finalContours.length === 0) {
        throw new Error(
          "Could not detect a usable outline. Try an image with a transparent background.",
        );
      }

      // Set the raster cutline polygon (Overlay Mode)
      // Bolt Optimization: Replace nested .map() with pre-allocated arrays and for-loops
      const rasterCutlineOutput = new Array(finalContours.length);
      for (let i = 0; i < finalContours.length; i++) {
        const poly = finalContours[i];
        const newPoly = new Array(poly.length);
        for (let j = 0; j < poly.length; j++) {
          const p = poly[j];
          newPoly[j] = { x: p.x / dpr, y: p.y / dpr };
        }
        rasterCutlineOutput[i] = newPoly;
      }
      rasterCutlinePoly = rasterCutlineOutput;

      // Generate the cutline immediately
      const cutline = generateCutLine(
        rasterCutlinePoly,
        cutlineOffset,
        lazyLassoRadius,
      );
      currentCutline = cutline;
      currentBounds = getPolygonsBounds(cutline);

      // Redraw decorations (which will now include the cutline overlay)
      // Note: We are drawing on top of the existing canvas. Previous decorations might be baked in if not cleared,
      // but this preserves the raster image state (rotation, etc).
      drawCanvasDecorations(currentBounds);

      calculateAndUpdatePrice();
      showNotification("Smart cutline generated successfully.", "success");
    } catch (error) {
      // Restore the original canvas if the process failed
      ctx.putImageData(originalCanvasData, 0, 0);
      showNotification(`Error: ${error.message}`, "error");
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
    const token =
      localStorage.getItem("authToken") ||
      localStorage.getItem("splotch_token");

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
    showNotification("Please enter a valid name and profit amount.", "error");
    return;
  }

  // We need to upload the file first if it's not already on the server?
  // Actually, handlePaymentFormSubmit uploads it. We need a similar flow here.
  // OR we reuse the upload endpoint.
  // But `handleFileChange` just reads locally.

  // 1. Get auth token
  const token =
    localStorage.getItem("authToken") || localStorage.getItem("splotch_token");
  if (!token) {
    showNotification("You must be logged in to sell designs.", "error");
    return;
  }

  try {
    // 2. Upload Design
    const designImageBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const uploadFormData = new FormData();
    uploadFormData.append("designImage", designImageBlob, "design.png");

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
    document.getElementById("copyLinkBtn")?.focus();
  } catch (error) {
    console.error(error);
    showNotification("Failed to create product: " + error.message, "error");
  }
}

async function handleRemoteImageLoad(imageUrl) {
  showNotification("Loading your previous design...", "info");
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

    // Generate cutline based on image transparency
    const currentImageData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = canvas.width / dpr;
    const logicalHeight = canvas.height / dpr;

    if (imageHasTransparentBorder(currentImageData)) {
      handleGenerateCutline(true);
    } else {
      rasterCutlinePoly = [
        [
          { x: 0, y: 0 },
          { x: logicalWidth, y: 0 },
          { x: logicalWidth, y: logicalHeight },
          { x: 0, y: logicalHeight },
        ],
      ];

      cutlineOffset = 5;
      if (cutlineOffsetSlider) {
        cutlineOffsetSlider.value = 5;
      }
      if (cutlineOffsetValueDisplay) {
        cutlineOffsetValueDisplay.textContent = cutlineOffset;
      }

      const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
      currentCutline = cutline;
      currentBounds = getPolygonsBounds(cutline);
    }

    calculateAndUpdatePrice();
    drawCanvasDecorations(currentBounds);
    if (clearFileBtn) clearFileBtn.classList.remove("hidden");

    // Show Legend
    renderLegend();

    showNotification("Design loaded! You can now adjust options.", "success");
  };
  img.onerror = () => showNotification("Failed to load design image.", "error");
  img.src = decodeURIComponent(imageUrl);
}

async function loadProductForBuyer(productId) {
  try {
    currentProductId = productId;
    showNotification("Loading product design...", "info");

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

      // Generate cutline based on image transparency
      const currentImageData = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = canvas.width / dpr;
      const logicalHeight = canvas.height / dpr;

      if (imageHasTransparentBorder(currentImageData)) {
        handleGenerateCutline(true);
      } else {
        rasterCutlinePoly = [
          [
            { x: 0, y: 0 },
            { x: logicalWidth, y: 0 },
            { x: logicalWidth, y: logicalHeight },
            { x: 0, y: logicalHeight },
          ],
        ];

        cutlineOffset = 5;
        if (cutlineOffsetSlider) {
          cutlineOffsetSlider.value = 5;
        }
        if (cutlineOffsetValueDisplay) {
          cutlineOffsetValueDisplay.textContent = cutlineOffset;
        }

        const cutline = generateCutLine(rasterCutlinePoly, cutlineOffset);
        currentCutline = cutline;
        currentBounds = getPolygonsBounds(cutline);
      }
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

      // Show Legend
      renderLegend();

      showNotification("Design loaded!", "success");
    };
    img.crossOrigin = "Anonymous"; // Important for canvas manipulation if on different port
    img.src = product.designImagePath;
  } catch (error) {
    console.error(error);
    showNotification("Failed to load product.", "error");
  }
}
