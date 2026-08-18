import { SVGParser } from "./lib/svgparser.js";
import {
  calculateStickerPrice,
  calculatePerimeter,
  generateSvgFromCutline,
  generateMultiLayerSvg,
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
  processCustomLayerMask,
} from "./lib/image-processing.js";
import { showNotification } from "./notifications.js";
import {
  stickers,
  activeStickerIndex,
  addSticker,
  removeSticker,
  moveSticker,
  setActiveSticker,
  getActiveSticker,
  clearStickers,
} from "./lib/stickers.js";
import Sortable from "sortablejs";

// index.js

const appId = "sandbox-sq0idb-tawTw_Vl7VGYI6CZfKEshA";
const locationId = "LTS82DEX24XR0";
const serverUrl = ""; // Define server URL once

// Web Workers for heavy processing
const traceWorker = new Worker(
  new URL("./workers/trace-worker.js", import.meta.url),
  { type: "module" },
);
const offsetWorker = new Worker(
  new URL("./workers/offset-worker.js", import.meta.url),
  { type: "module" },
);

// Catch Worker Errors
traceWorker.onerror = (error) => {
  console.error(
    "Trace Worker Error:",
    error.message,
    "at",
    error.filename,
    ":",
    error.lineno,
  );
  hideCanvasLoading();
  import("./notifications.js").then(({ showNotification }) => {
    showNotification(`Worker initialization failed: ${error.message}`, "error");
  });
};

offsetWorker.onerror = (error) => {
  console.error(
    "Offset Worker Error:",
    error.message,
    "at",
    error.filename,
    ":",
    error.lineno,
  );
  hideCanvasLoading();
};

// Declare globals for SDK objects and key DOM elements
let payments, card, csrfToken;
let canvas, ctx;

function getActiveBase() {
  if (activeStickerIndex >= 0 && activeStickerIndex < stickers.length) {
    return stickers[activeStickerIndex];
  }
  // Fallback if none is active but we need a target to write to
  if (stickers.length === 0) {
    stickers.push({
      originalImage: null,
      cleanCanvasState: null,
      rasterCutlinePoly: null,
      currentPolygons: [],
      basePolygons: [],
      currentCutline: [],
      customLayers: [],
      layerOrder: ["base", "cutline"],
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      visible: true,
    });
    setActiveSticker(0);
  }
  return stickers[activeStickerIndex >= 0 && activeStickerIndex < stickers.length ? activeStickerIndex : 0];
}

const activeBase = new Proxy(
  {},
  {
    get: function (target, prop) {
      return prop == 'originalImage' ? getActiveBase().image : getActiveBase()[prop];
    },
    set: function (target, prop, value) {
      if(prop == 'originalImage') getActiveBase().image = value; else getActiveBase()[prop] = value;
      return true;
    },
  },
);

// Globals for SVG
let isMetric = false;
let baseCanvasWidth = 500; // Fixed bounding box frame width
let baseCanvasHeight = 400; // Fixed bounding box frame height
let currentBounds = null;
let organicSheetCutline = null; // Automatically generated boolean union of all layer cutlines
let sheetBoundaryConfig = {
  shape: 'contour', // 'contour', 'square', 'circle'
  margin: 0.125 // inches
};
let pricingConfig = null;
let inventoryCache = {}; // Cache for Odoo inventory
let isGrayscale = false;
let isSepia = false;
let isXRay = false;
let currentLayerType = "base";
let fileInputDisabled = false;
let cachedTempCanvas = null;
let easterEggUnlocked = false;

// Legend state
let hoveredLegendTab = null;
let selectedLegendTab = null;

// Layer controls state

let textInput,
  textSizeInput,
  textSizeSlider,
  textColorInput,
  addTextBtn,
  textFontFamilySelect,
  textEditingControlsContainer,
  printInkControlsContainer,
  cutlineOffsetSlider,
  cutlineOffsetValueDisplay,
  cutlineSensitivitySlider,
  cutlineSensitivityValueDisplay,
  lazyLassoSlider,
  lazyLassoValueDisplay,
  printInkImageUpload,
  alphaColorPicker,
  maskColorPicker,
  cutTypeSelect;
let cutlineSensitivity = 42; // Default sensitivity
let stickerMaterialSelect,
  stickerResolutionSelect,
  designMarginNote,
  stickerQuantityInput,
  calculatedPriceDisplay;

let currentTemplate = "blank";
let templateBlankBtn;
let templateHelloBtn;
let templateThankYouBtn;
let discountTableContainer;
let discountTableBody;
let promoAddonCheckbox;
let promoAddonStatusMsg;

// Original Image and File State
let paymentStatusContainer,
  ipfsLinkContainer,
  fileInputGlobalRef,
  paymentFormGlobalRef;
let rotateLeftBtnEl,
  rotateRightBtnEl,
  resetBtnEl,
  clearFileBtn,
  resizeInputEl,
  resizeBtnEl,
  grayscaleBtnEl,
  sepiaBtnEl;
let submitPaymentBtn;
let widthInputEl, heightInputEl;
let canvasPlaceholder;
let canvasLegendContainer;
let canvasLoadingOverlay, canvasLoadingText, canvasLoadingSubtext;

export function showCanvasLoading(
  mainText = "Processing Image...",
  subText = "Analyzing transparency & generating cutlines",
) {
  if (!canvasLoadingOverlay) {
    canvasLoadingOverlay = document.getElementById("canvas-loading-overlay");
    canvasLoadingText = document.getElementById("canvas-loading-text");
    canvasLoadingSubtext = document.getElementById("canvas-loading-subtext");
  }
  if (!canvasLoadingOverlay) return;

  if (canvasLoadingText && mainText) canvasLoadingText.textContent = mainText;
  if (canvasLoadingSubtext && subText)
    canvasLoadingSubtext.textContent = subText;

  canvasLoadingOverlay.classList.remove("opacity-0", "pointer-events-none");
  canvasLoadingOverlay.classList.add("opacity-100");
}

export function updateCanvasLoading(mainText, subText) {
  if (!canvasLoadingOverlay) {
    canvasLoadingOverlay = document.getElementById("canvas-loading-overlay");
    canvasLoadingText = document.getElementById("canvas-loading-text");
    canvasLoadingSubtext = document.getElementById("canvas-loading-subtext");
  }
  if (!canvasLoadingOverlay) return;

  if (canvasLoadingText && mainText) canvasLoadingText.textContent = mainText;
  if (canvasLoadingSubtext && subText)
    canvasLoadingSubtext.textContent = subText;
}

export function hideCanvasLoading() {
  if (!canvasLoadingOverlay) {
    canvasLoadingOverlay = document.getElementById("canvas-loading-overlay");
  }
  if (!canvasLoadingOverlay) return;

  canvasLoadingOverlay.classList.remove("opacity-100");
  canvasLoadingOverlay.classList.add("opacity-0", "pointer-events-none");
}

let currentOrderAmountCents = 0;
let currentProductId = null; // Track if we are in "Product Mode"
let creatorProfitCents = 0; // The markup for the current product

// Memoization globals for pricing
let lastCalculatedPerimeter = 0;
let lastCalculatedPerimeterCutlineRef = null;

function generateOrganicSheetBoundary() {
  if (stickers.length === 0) {
    organicSheetCutline = null;
    return;
  }

  const stickerResolutionSelect = document.getElementById("stickerResolution");
  let ppi = 300;
  if (pricingConfig && pricingConfig.resolutions) {
    const selectedRes = pricingConfig.resolutions.find(r => r.id === (stickerResolutionSelect ? stickerResolutionSelect.value : "dpi_300"));
    if (selectedRes) {
      ppi = selectedRes.dpi;
    }
  }

  const marginPx = sheetBoundaryConfig.margin * ppi;

  const clipper = new ClipperLib.Clipper();
  let hasCutline = false;

  console.log("BROWSER LOG: generateOrganicSheetBoundary start. Layers:", stickers.length);
  stickers.forEach((layer) => {
    console.log("BROWSER LOG: Layer check:", layer.id, "currentCutline?", !!layer.currentCutline, "length:", layer.currentCutline?.length, "visible:", layer.visible);
    if (layer.currentCutline && layer.currentCutline.length > 0 && layer.visible !== false) {
      // Offset the cutline to world coordinates
      const offsetPolygons = layer.currentCutline.map(poly => 
        poly.map(pt => ({
          X: pt.x + (layer.x || 0),
          Y: pt.y + (layer.y || 0)
        }))
      );
      
      // Add to clipper as subject
      clipper.AddPaths(offsetPolygons, ClipperLib.PolyType.ptSubject, true);
      hasCutline = true;
    }
  });

  console.log("BROWSER LOG: generateOrganicSheetBoundary hasCutline:", hasCutline);
  if (!hasCutline) {
    organicSheetCutline = null;
    return;
  }

  const solution = new ClipperLib.Paths();
  // Perform union of all subject paths
  const success = clipper.Execute(ClipperLib.ClipType.ctUnion, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  console.log("BROWSER LOG: generateOrganicSheetBoundary clipper success:", success, "solution length:", solution.length);

  if (success && solution.length > 0) {
    let finalPaths = solution;

    if (sheetBoundaryConfig.shape === 'contour') {
      if (marginPx > 0) {
        const co = new ClipperLib.ClipperOffset();
        co.AddPaths(solution, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        const offsetPaths = new ClipperLib.Paths();
        co.Execute(offsetPaths, marginPx);
        if (offsetPaths.length > 0) {
          finalPaths = offsetPaths;
        }
      }
    } else {
      // square or circle bounding box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let j = 0; j < solution.length; j++) {
        const poly = solution[j];
        for (let i = 0; i < poly.length; i++) {
          if (poly[i].X < minX) minX = poly[i].X;
          if (poly[i].X > maxX) maxX = poly[i].X;
          if (poly[i].Y < minY) minY = poly[i].Y;
          if (poly[i].Y > maxY) maxY = poly[i].Y;
        }
      }
      
      if (sheetBoundaryConfig.shape === 'square') {
        const box = [
          { X: minX - marginPx, Y: minY - marginPx },
          { X: maxX + marginPx, Y: minY - marginPx },
          { X: maxX + marginPx, Y: maxY + marginPx },
          { X: minX - marginPx, Y: maxY + marginPx }
        ];
        finalPaths = [box];
      } else if (sheetBoundaryConfig.shape === 'circle') {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const w = maxX - minX;
        const h = maxY - minY;
        const r = Math.max(w, h) / 2 + marginPx;
        const circle = [];
        const numPoints = 64;
        for (let i = 0; i < numPoints; i++) {
          const theta = (i / numPoints) * 2 * Math.PI;
          circle.push({
            X: cx + r * Math.cos(theta),
            Y: cy + r * Math.sin(theta)
          });
        }
        finalPaths = [circle];
      }
    }

    // Convert back from Clipper objects
    organicSheetCutline = finalPaths.map(poly => poly.map(pt => ({ x: pt.X, y: pt.Y })));
    console.log("BROWSER LOG: generateOrganicSheetBoundary SUCCESS. organicSheetCutline set.");
  } else {
    organicSheetCutline = null;
    console.log("BROWSER LOG: generateOrganicSheetBoundary FAILED. organicSheetCutline null.");
  }
}



// Helper to get active line interaction state
function getActiveLineId() {
  console.log(`[CLIENT] getActiveLineId called. hovered: ${hoveredLegendTab}, selected: ${selectedLegendTab}`);
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
  printInkImageUpload = document.getElementById("printInkImageUpload");
  alphaColorPicker = document.getElementById("alphaColorPicker");
  maskColorPicker = document.getElementById("maskColorPicker");
  cutTypeSelect = document.getElementById("cutTypeSelect");

  widthInputEl = document.getElementById("widthInput");
  heightInputEl = document.getElementById("heightInput");

  const updateSizeFromInput = (e) => {
    if (!currentBounds) return;
    let targetWidth = parseFloat(widthInputEl.value);
    let targetHeight = parseFloat(heightInputEl.value);

    const resolutionId = stickerResolutionSelect
      ? stickerResolutionSelect.value || "dpi_300"
      : "dpi_300";
    const selectedResolution =
      pricingConfig && pricingConfig.resolutions
        ? pricingConfig.resolutions.find((r) => r.id === resolutionId)
        : null;
    const ppi = selectedResolution ? selectedResolution.ppi : 300;

    let currentCutlineWidth = currentBounds.width / ppi;
    let currentCutlineHeight = currentBounds.height / ppi;

    const isMetric =
      document.getElementById("unitToggle") &&
      document.getElementById("unitToggle").checked;
    if (isMetric) {
      currentCutlineWidth *= 25.4;
      currentCutlineHeight *= 25.4;
    }

    let scaleFactor = 1;
    if (e.target === widthInputEl) {
      scaleFactor = targetWidth / currentCutlineWidth;
      targetHeight = currentCutlineHeight * scaleFactor;
      if (heightInputEl) heightInputEl.value = targetHeight.toFixed(2);
    } else {
      scaleFactor = targetHeight / currentCutlineHeight;
      targetWidth = currentCutlineWidth * scaleFactor;
      if (widthInputEl) widthInputEl.value = targetWidth.toFixed(2);
    }

    const resizeSliderEl = document.getElementById("resizeSlider");
    if (resizeSliderEl) {
      let currentSliderValue = parseFloat(resizeSliderEl.value);
      let newSliderValue = currentSliderValue * scaleFactor;
      resizeSliderEl.value = newSliderValue;
      resizeSliderEl.dispatchEvent(new Event("input"));
    }
  };

  if (widthInputEl)
    widthInputEl.addEventListener("change", updateSizeFromInput);
  if (heightInputEl)
    heightInputEl.addEventListener("change", updateSizeFromInput);

  canvasLegendContainer = document.getElementById("canvas-legend");

  rotateLeftBtnEl = document.getElementById("rotateLeftBtn");
  rotateRightBtnEl = document.getElementById("rotateRightBtn");
  resetBtnEl = document.getElementById("resetBtn");
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

  // New E-commerce / Template UI Elements
  templateBlankBtn = document.getElementById("templateBlankBtn");
  templateHelloBtn = document.getElementById("templateHelloBtn");
  templateThankYouBtn = document.getElementById("templateThankYouBtn");
  discountTableContainer = document.getElementById("discountTableContainer");
  discountTableBody = document.getElementById("discountTableBody");
  promoAddonCheckbox = document.getElementById("promoAddonCheckbox");
  promoAddonStatusMsg = document.getElementById("promoAddonStatusMsg");

  if (promoAddonCheckbox) {
    promoAddonCheckbox.addEventListener("change", () => {
      calculateAndUpdatePrice();
    });
  }

  if (templateBlankBtn)
    templateBlankBtn.addEventListener("click", () => setTemplate("blank"));
  if (templateHelloBtn)
    templateHelloBtn.addEventListener("click", () =>
      setTemplate("hello_badge"),
    );
  if (templateThankYouBtn)
    templateThankYouBtn.addEventListener("click", () =>
      setTemplate("thank_you"),
    );

  // Fetch CSRF token and pricing info
  // Fetch CSRF token first to establish the session cookie, avoiding race conditions with other requests
  await fetchCsrfToken();
  await Promise.all([fetchPricingInfo(), fetchInventory()]);

  // Initialize Square Payments SDK
  if (!window.PLAYWRIGHT_TEST_MODE) {
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
        console.warn(
          `[CLIENT] Square SDK init failed (attempt ${retryCount}/${maxRetries}):`,
          error,
        );
        if (retryCount >= maxRetries) {
          let msg = `Failed to initialize payments: ${error.message}`;
          if (
            error.message.includes("Network") ||
            typeof Square === "undefined"
          ) {
            msg += " (Check your AdBlocker)";
            showAdBlockerWarning();
          }
          showPaymentStatus(msg, "error");
          console.error(
            "[CLIENT] Failed to initialize Square payments SDK:",
            error,
          );
        } else {
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  } else {
    console.log(
      "[CLIENT] PLAYWRIGHT_TEST_MODE: Skipping Square initialization.",
    );
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
    stickerMaterialSelect.addEventListener("change", (e) => {
      calculateAndUpdatePrice();
      populateLayerDropdown(e.target.value);
    });
  }
  if (stickerResolutionSelect) {
    stickerResolutionSelect.addEventListener("change", () => {
      calculateAndUpdatePrice();
      if (activeBase.originalImage || activeBase.basePolygons.length > 0) {
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
  const cutShapeSelect = document.getElementById("cutShapeSelect");
  if (cutShapeSelect) {
    cutShapeSelect.addEventListener("change", () => {
      const activeSticker = getActiveSticker();
      if (activeSticker && (activeSticker.image || activeSticker.originalImage || activeSticker.basePolygons?.length)) {
        handleGenerateCutline(true);
      }
    });
  }

  const generateCutlineBtn = document.getElementById("generateCutlineBtn");
  if (generateCutlineBtn)
    generateCutlineBtn.addEventListener("click", () =>
      handleGenerateCutline(false),
    );

  const downloadCutlineBtn = document.getElementById("downloadCutlineBtn");
  if (downloadCutlineBtn)
    downloadCutlineBtn.addEventListener("click", handleDownloadCutline);

  const generateFromBaseBtn = document.getElementById("generateFromBaseBtn");
  if (generateFromBaseBtn)
    generateFromBaseBtn.addEventListener("click", () =>
      handleGenerateFromBase(),
    );

  const printInkTypeSelect = document.getElementById(
    "printInkTypeSelect",
  );
  if (printInkTypeSelect) {
    printInkTypeSelect.addEventListener("change", (e) => {
      const activeTabId = getActiveLineId();
      if (!activeTabId || activeTabId === "base" || activeTabId === "cutline")
        return;
      const layer = activeBase.customLayers.find((l) => l.id === activeTabId);
      if (layer) {
        layer.subType = e.target.value;
      }
    });
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  if (cutlineOffsetSlider) {
    const handleSliderInput = debounce((e) => {
      const step = parseInt(e.target.value, 10);
      let textLabel = "1.5mm";
      if (step === 0) {
        cutlineOffset = 0;
        textLabel = "0mm (None)";
      } else if (step === 1) {
        cutlineOffset = 15;
        textLabel = "1.5mm";
      } else if (step === 2) {
        cutlineOffset = 35;
        textLabel = "3mm";
      }

      if (activeBase) {
        activeBase.cutlineOffset = cutlineOffset;
      }

      if (cutlineOffsetValueDisplay)
        cutlineOffsetValueDisplay.textContent = textLabel;

      let currentLassoRadius =
        lazyLassoSlider && lazyLassoSlider.value
          ? parseInt(lazyLassoSlider.value, 10)
          : 50;

      if (activeBase) {
        activeBase.lazyLassoRadius = currentLassoRadius;
      }

      if (activeBase.rasterCutlinePoly) {
        generateCutLineAsync(
          activeBase.rasterCutlinePoly,
          activeBase.cutlineOffset,
          activeBase.lazyLassoRadius,
        ).then((cutline) => {
          activeBase.currentCutline = cutline;
          currentBounds = getPolygonsBounds(cutline);
          calculateAndUpdatePrice();
          drawCanvasDecorations(currentBounds);
        });
      } else if (activeBase.basePolygons.length > 0) {
        generateCutLineAsync(
          activeBase.currentPolygons,
          cutlineOffset,
          currentLassoRadius,
        ).then((cutline) => {
          activeBase.currentCutline = cutline;
          currentBounds = getPolygonsBounds(cutline);
          redrawAll();
        });
      }
    }, 100);

    cutlineOffsetSlider.addEventListener("input", handleSliderInput);

    // Fallback for tests that fire change without input
    cutlineOffsetSlider.addEventListener("change", handleSliderInput);
  }

  if (cutlineSensitivitySlider) {
    // Update value display immediately
    cutlineSensitivitySlider.addEventListener("input", (e) => {
      cutlineSensitivity = parseInt(e.target.value, 10);
      if (cutlineSensitivityValueDisplay) {
        cutlineSensitivityValueDisplay.textContent = cutlineSensitivity;
      }
      if (!easterEggUnlocked) {
        if (activeBase.originalImage && activeBase.rasterCutlinePoly) {
          handleGenerateCutline();
        }
      }
    });

    // Trigger regeneration only on change (mouse up) to avoid lag
    cutlineSensitivitySlider.addEventListener("change", () => {
      if (activeBase.originalImage && activeBase.rasterCutlinePoly) {
        handleGenerateCutline();
      }
    });
  }

  if (lazyLassoSlider) {
    const handleLassoInput = debounce((e) => {
      if (lazyLassoValueDisplay) {
        lazyLassoValueDisplay.textContent = e.target.value;
      }
      if (!easterEggUnlocked) {
        if (activeBase.rasterCutlinePoly) {
          generateCutLineAsync(
            activeBase.rasterCutlinePoly,
            cutlineOffset,
            parseInt(e.target.value, 10),
          ).then((cutline) => {
            activeBase.currentCutline = cutline;
            currentBounds = getPolygonsBounds(cutline);
            calculateAndUpdatePrice();
            drawCanvasDecorations(currentBounds);
          });
        } else if (activeBase.basePolygons.length > 0) {
          redrawAll();
        }
      }
    }, 100);

    lazyLassoSlider.addEventListener("input", handleLassoInput);

    // Trigger regeneration only on change (mouse up) to avoid lag
    lazyLassoSlider.addEventListener("change", () => {
      if (activeBase.originalImage && activeBase.rasterCutlinePoly) {
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
      if (
        !activeBase.originalImage ||
        !activeBase.currentCutline ||
        activeBase.currentCutline.length === 0
      ) {
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
      if (activeBase.originalImage || activeBase.currentPolygons.length > 0) {
        calculateAndUpdatePrice();
        redrawAll();
      }
    });
  }

  if (fileInputGlobalRef) {
    fileInputGlobalRef.addEventListener("change", handleFileChange);
  }

  if (printInkImageUpload) {
    printInkImageUpload.addEventListener("change", handleCustomLayerUpload);
  }

  if (alphaColorPicker) {
    alphaColorPicker.addEventListener("input", (e) => {
      const activeLayer = getActiveSticker();
      if (activeLayer) {
        activeLayer.alphaColorHex = e.target.value;
        if (activeLayer.originalImage) {
          reprocessCustomLayer(activeLayer);
        }
      }
    });
  }

  if (maskColorPicker) {
    maskColorPicker.addEventListener("input", (e) => {
      const activeLayer = getActiveSticker();
      if (activeLayer) {
        activeLayer.maskColorHex = e.target.value;
        if (activeLayer.originalImage) {
          reprocessCustomLayer(activeLayer);
        }
      }
    });
  }

  if (cutTypeSelect) {
    cutTypeSelect.addEventListener("change", () => {
      calculateAndUpdatePrice();
    });
  }

  // Add paste listeners to the canvas
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
      if (e.dataTransfer.getData("application/x-mascot-drag")) {
        showCanvasLoading("Loading Mascot...", "Fetching asset & preparing canvas");
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
            .catch((err) => {
              console.error("Failed to load mascot", err);
              hideCanvasLoading();
            });
        }
        return;
      }

      const file = e.dataTransfer.files[0];
      if (file) {
        showCanvasLoading("Loading Image...", "Reading file data");
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
        showCanvasLoading("Loading Mascot...", "Fetching asset & preparing canvas");
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
            .catch((err) => {
              console.error("Failed to load mascot", err);
              hideCanvasLoading();
            });
        }
        return;
      }

      const file = e.dataTransfer.files[0];
      if (file) {
        showCanvasLoading("Loading Image...", "Reading file data");
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
      const easterEggInput = document.getElementById("easterEggInput");
      if (easterEggInput) easterEggInput.style.display = "block";

      const easterEggControls = document.getElementById("easter-egg-controls");
      if (easterEggControls) easterEggControls.classList.remove("hidden");

      // Attempt to find elements again if globals are null
      const grayBtn = document.getElementById("grayscaleBtn");
      const sepBtn = document.getElementById("sepiaBtn");
      const textContainer = document.getElementById("text-editing-controls");
      const cutlineSensitivityContainer = document.getElementById(
        "cutlineSensitivityContainer",
      );
      const lazyLassoContainer = document.getElementById("lazyLassoContainer");
      const generateCutlineBtn = document.getElementById("generateCutlineBtn");
      const downloadCutlineBtn = document.getElementById("downloadCutlineBtn");
      const starterTemplatesSection = document.getElementById(
        "starterTemplatesSection",
      );
      printInkControlsContainer = document.getElementById(
        "layer-controls-container",
      );

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
      if (downloadCutlineBtn) {
        downloadCutlineBtn.style.display = "flex";
      }

      const isDisabled =
        !activeBase.originalImage && activeBase.basePolygons.length === 0;
      if (printInkControlsContainer) {
        printInkControlsContainer.style.display = "block";
      }

      if (starterTemplatesSection) {
        starterTemplatesSection.style.display = "block";
      }

      updateEditingButtonsState(isDisabled);

      showNotification("Secret features unlocked! 🎨", "success");
    }
  });

  // Initial UI state
  if (!productIdParam) {
    updateEditingButtonsState(!activeBase.originalImage);
  }
  if (designMarginNote) designMarginNote.style.display = "none";

  // Signal for E2E tests that initialization is fully complete
  window.__appInitialized = true;

  // Initialize layer tabs UI state (even without an image) so controls have a tab
  renderLayerTabs();
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

function updateCompositeImage() {
  // Redraw the active layer bounding box if necessary
  // In a real multi-layer engine we would draw ALL layers here,
  // but for now, we just update the UI state.
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
  const cutline = activeBase.currentCutline;

  if (isNaN(quantity) || quantity < 0) {
    currentOrderAmountCents = 0;
    calculatedPriceDisplay.textContent =
      quantity < 0 ? "Invalid Quantity" : formatPrice(0);
    return;
  }

  if (!bounds || !cutline || !selectedResolution) {
    currentOrderAmountCents = 0;
    calculatedPriceDisplay.innerHTML = `Price: <span class="text-gray-500">---</span>`;
    if (widthInputEl) widthInputEl.value = "";
    if (heightInputEl) heightInputEl.value = "";
    return;
  }

  // Bolt Optimization: Memoize the perimeter calculation to avoid O(N) loop on every input event (like typing quantity)
  if (cutline && cutline !== lastCalculatedPerimeterCutlineRef) {
    lastCalculatedPerimeter = calculatePerimeter(cutline);
    lastCalculatedPerimeterCutlineRef = cutline;
  }

  const allCustomLayers = [];
  if (typeof stickers !== "undefined") {
    stickers.forEach((s) => {
      if (s.customLayers) {
        s.customLayers.forEach((l) => {
          allCustomLayers.push({
            type: l.type,
            subType: l.subType,
          });
        });
      }
    });
  }
  const numImageLayers =
    typeof stickers !== "undefined" && stickers
      ? stickers.length
      : 1;

  const priceResult = calculateStickerPrice(
    pricingConfig,
    quantity,
    selectedMaterial,
    bounds,
    cutline,
    selectedResolution,
    lastCalculatedPerimeter,
    allCustomLayers,
    numImageLayers,
  );

  // --- Creator Markup Logic ---
  const totalMarkup = creatorProfitCents * quantity;
  currentOrderAmountCents = priceResult.total + totalMarkup;
  // ----------------------------

  // --- Promo Addon Logic ---
  if (promoAddonCheckbox && promoAddonCheckbox.checked) {
    if (quantity >= 50) {
      if (promoAddonStatusMsg) {
        promoAddonStatusMsg.textContent = "FREE PROMO STICKER APPLIED!";
        promoAddonStatusMsg.className =
          "text-green-600 font-bold mt-1 text-xs uppercase tracking-wide";
      }
    } else {
      currentOrderAmountCents += 200; // $2.00
      if (promoAddonStatusMsg) {
        promoAddonStatusMsg.textContent = "Free on orders of 50 or more items!";
        promoAddonStatusMsg.className =
          "text-indigo-700 font-bold mt-1 text-xs uppercase tracking-wide";
      }
    }
  } else {
    if (promoAddonStatusMsg) {
      promoAddonStatusMsg.textContent = "Free on orders of 50 or more items!";
      promoAddonStatusMsg.className =
        "text-indigo-700 font-bold mt-1 text-xs uppercase tracking-wide";
    }
  }
  // -------------------------

  // --- Render Discount Table ---
  if (
    pricingConfig &&
    pricingConfig.quantityDiscounts &&
    discountTableContainer &&
    discountTableBody
  ) {
    discountTableContainer.classList.remove("hidden");
    discountTableBody.innerHTML = "";

    // Convert discounts array and sort by quantity ascending for display
    const discounts = [...pricingConfig.quantityDiscounts]
      .map((d) => ({
        minQty: d.quantity,
        discountPercent: Math.round(d.discount * 100),
      }))
      .sort((a, b) => a.minQty - b.minQty);

    discounts.forEach((tier) => {
      const isCurrentTier =
        quantity >= tier.minQty &&
        !discounts.find((t) => t.minQty > tier.minQty && quantity >= t.minQty);

      const row = document.createElement("tr");
      if (isCurrentTier) {
        row.className = "bg-indigo-100 font-semibold";
      } else {
        row.className = "border-t border-gray-100";
      }

      row.innerHTML = `
        <td class="px-2 py-1">${tier.minQty}+</td>
        <td class="px-2 py-1 text-right text-indigo-700">-${tier.discountPercent}%</td>
      `;
      discountTableBody.appendChild(row);
    });
  }
  // -----------------------------

  const ppi = selectedResolution.ppi;
  let width = bounds.width / ppi;
  let height = bounds.height / ppi;
  let unit = "in";

  if (isMetric) {
    width *= 25.4;
    height *= 25.4;
    unit = "mm";
  }

  if (widthInputEl && document.activeElement !== widthInputEl)
    widthInputEl.value = width.toFixed(2);
  if (heightInputEl && document.activeElement !== heightInputEl)
    heightInputEl.value = height.toFixed(2);

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
    const response = await fetch(
      `${serverUrl}/api/pricing-info?t=${Date.now()}`,
    );
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

    // Initial layers population based on default material
    if (stickerMaterialSelect) {
      populateLayerDropdown(stickerMaterialSelect.value);
    }

    // Re-render layer tabs now that pricingConfig is loaded
    renderLayerTabs();
  } catch (error) {
    console.error("[CLIENT] Error fetching pricing info:", error);
    showPaymentStatus(
      "Could not load pricing information. Please refresh.",
      "error",
    );
  }
}

function populateLayerDropdown(materialId) {
  const printInkSelect = document.getElementById("printInkSelect");
  if (!printInkSelect || !pricingConfig) return;

  printInkSelect.innerHTML = "";

  const material = pricingConfig.materials.find((m) => m.id === materialId);
  if (material && material.supportedLayers) {
    material.supportedLayers.forEach((layer) => {
      const option = document.createElement("option");
      option.value = layer;
      // Capitalize first letter
      option.textContent = layer.charAt(0).toUpperCase() + layer.slice(1);
      printInkSelect.appendChild(option);
    });
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

  if (pricingConfig && pricingConfig.materials) {
    const materialData = pricingConfig.materials.find(
      (m) => m.id === materialId,
    );
    if (materialData && materialData.description) {
      const helperEl = document.getElementById("material-helper");
      if (helperEl) {
        helperEl.innerHTML = `<span class="block mt-2 p-2 bg-blue-50 border border-blue-100 rounded text-blue-800 text-xs">${materialData.description}</span>`;
      }
    }
  }

  let warningEl = document.getElementById("material-warning");
  if (!warningEl) {
    warningEl = document.createElement("p");
    warningEl.id = "material-warning";
    warningEl.className = "text-xs text-red-500 mt-1";
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
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "same-origin", // MUST save the session cookie for the token to be valid!
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
  console.log(
    "BROWSER LOG: Processing order check stickers length:",
    stickers.length,
  );

  // --- NEW VALIDATION: Ensure an image exists before proceeding ---
  if (stickers.length === 0 && activeBase.basePolygons.length === 0) {
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
  console.log("BROWSER LOG: Email:", email);
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
    console.log("BROWSER LOG: Issuing temp token with CSRF:", csrfToken);
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
    console.log("BROWSER LOG: Payment Submit - organicSheetCutline:", !!organicSheetCutline, "currentBounds:", !!currentBounds, "activeBase.currentCutline:", !!activeBase.currentCutline);
    if (cutLineFileInput && cutLineFileInput.files[0]) {
      uploadFormData.append("cutLineFile", cutLineFileInput.files[0]);
    } else if (organicSheetCutline && organicSheetCutline.length > 0 && currentBounds) {
      // Generate multi-layer SVG for the entire sheet
      console.log("BROWSER LOG: Generating Multi-Layer SVG");
      const svgContent = generateMultiLayerSvg(
        stickers,
        organicSheetCutline,
        currentBounds
      );
      console.log("BROWSER LOG: Multi-layer SVG includes Kiss-Cut?", svgContent.includes("Kiss-Cut"));
      if (svgContent) {
        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        uploadFormData.append("cutLineFile", blob, "generated-cutline.svg");
      }
    } else if (
      activeBase.currentCutline &&
      activeBase.currentCutline.length > 0 &&
      currentBounds
    ) {
      // Fallback for single sticker design
      console.log("BROWSER LOG: Generating Fallback Single-Layer SVG");
      const svgContent = generateSvgFromCutline(
        activeBase.currentCutline,
        currentBounds,
      );
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
    let sourceId = "cnon:card-nonce-ok";
    if (!window.PLAYWRIGHT_TEST_MODE) {
      showPaymentStatus("Securing card details...", "info");
      console.log("[CLIENT] Tokenizing card with verification details.");
      // UPDATED: Pass the new verificationDetails object to tokenize
      sourceId = await tokenize(card, verificationDetails);
    }

    console.log(
      "[CLIENT] Tokenization successful. Nonce (sourceId):",
      sourceId,
    );

    const fileInput = document.getElementById("fileInput");
    const stickerName =
      fileInput && fileInput.files && fileInput.files.length > 0
        ? fileInput.files[0].name
        : "Custom Sticker";

    const allCustomLayers = [];
    if (typeof stickers !== "undefined") {
      stickers.forEach((s) => {
        if (s.customLayers) {
          s.customLayers.forEach((l) => {
            allCustomLayers.push({
              type: l.type,
              subType: l.subType,
            });
          });
        }
      });
    }

    // 4. Create JSON payload for the order
    const orderDetails = {
      resolution: stickerResolutionSelect
        ? stickerResolutionSelect.value
        : "unknown",
      quantity: stickerQuantityInput
        ? parseInt(stickerQuantityInput.value, 10)
        : 0,
      material: stickerMaterialSelect ? stickerMaterialSelect.value : "unknown",
      cutType: cutTypeSelect ? cutTypeSelect.value : "die_cut",
      stickerName: stickerName,
      promoAddon: promoAddonCheckbox ? promoAddonCheckbox.checked : false,
      customLayers: allCustomLayers.length > 0 ? allCustomLayers : null,
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

    // [INTERCEPT] Mocking network request for UI/UX testing
    console.log("[CLIENT] Intercepting network request for UI testing. Skipping actual server submission.");
    const responseData = { success: true, message: "Mock order created" };
    
    /*
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
      console.error("[CLIENT] Server returned an error:", responseData);

      // Check if the error is a CSRF token error, and if so, fetch a new one
      if (responseData.error && responseData.error.includes("csrf")) {
        showPaymentStatus(
          "Your security token has expired. Please try submitting again.",
          "error",
        );
        console.warn("[CLIENT] CSRF token was invalid. Fetching a new one.");
        await fetchCsrfToken(); // Fetch a new token for the next attempt
      }

      let errorMsg = responseData.error;
      if (
        !errorMsg &&
        responseData.errors &&
        Array.isArray(responseData.errors)
      ) {
        errorMsg = responseData.errors.map((err) => err.msg).join(", ");
      }

      throw new Error(errorMsg || "Failed to create order on server.");
    }
    */

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
  paymentStatusContainer.style.display = "block";
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

  const boundaryMarginLabelEl = document.getElementById("boundaryMarginLabel") || document.querySelector('label[for="boundaryMarginInput"]');
  const boundaryMarginSliderEl = document.getElementById("boundaryMarginSlider");
  const boundaryMarginInputEl = document.getElementById("boundaryMarginInput");

  if (boundaryMarginLabelEl) {
    boundaryMarginLabelEl.textContent = isMetric ? "Bleed Margin (mm)" : "Bleed Margin (inches)";
  }

  if (boundaryMarginSliderEl && boundaryMarginInputEl) {
    if (isMetric) {
      boundaryMarginSliderEl.min = "0";
      boundaryMarginSliderEl.max = (0.5 * inchesToMm).toFixed(1);
      boundaryMarginSliderEl.step = "0.5";
      const mmVal = ((sheetBoundaryConfig.margin || 0) * inchesToMm).toFixed(1);
      boundaryMarginSliderEl.value = mmVal;
      boundaryMarginInputEl.min = "0";
      boundaryMarginInputEl.max = (0.5 * inchesToMm).toFixed(1);
      boundaryMarginInputEl.step = "0.5";
      boundaryMarginInputEl.value = mmVal;
    } else {
      boundaryMarginSliderEl.min = "0";
      boundaryMarginSliderEl.max = "0.5";
      boundaryMarginSliderEl.step = "0.05";
      const inVal = (sheetBoundaryConfig.margin || 0).toFixed(2);
      boundaryMarginSliderEl.value = inVal;
      boundaryMarginInputEl.min = "0";
      boundaryMarginInputEl.max = "0.5";
      boundaryMarginInputEl.step = "0.05";
      boundaryMarginInputEl.value = inVal;
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
    document.getElementById("downloadCutlineBtn"),
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

  // Update styles for filter buttons based on easterEggUnlocked
  const grayBtn = document.getElementById("grayscaleBtn");
  const sepBtn = document.getElementById("sepiaBtn");
  const cutlineSensitivityContainer = document.getElementById(
    "cutlineSensitivityContainer",
  );
  const lazyLassoContainer = document.getElementById("lazyLassoContainer");
  const generateCutlineBtn = document.getElementById("generateCutlineBtn");
  const downloadCutlineBtn = document.getElementById("downloadCutlineBtn");

  if (!easterEggUnlocked) {
    if (grayBtn) grayBtn.style.display = "none";
    if (sepBtn) sepBtn.style.display = "none";
    if (cutlineSensitivityContainer)
      cutlineSensitivityContainer.style.display = "none";
    if (lazyLassoContainer) {
      lazyLassoContainer.style.display = "none";
    }
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
  }

  if (generateCutlineBtn) {
    generateCutlineBtn.style.display = disabled ? "none" : "flex";
  }
  if (downloadCutlineBtn) {
    const hasCutline = activeBase.currentCutline && activeBase.currentCutline.length > 0;
    downloadCutlineBtn.style.display = (disabled || !hasCutline) ? "none" : "flex";
  }
  if (canvasPlaceholder)
    canvasPlaceholder.style.display = disabled ? "flex" : "none";
}

function setCanvasSize(logicalWidth, logicalHeight) {
  if (!canvas || !ctx) return;
  baseCanvasWidth = logicalWidth;
  baseCanvasHeight = logicalHeight;
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
  activeBase.cleanCanvasState = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  cachedTempCanvas = null; // Invalidate cache
}

function restoreCleanState(drawOffset = { x: 0, y: 0 }) {
  if (!activeBase) return;
  restoreCleanStateForLayer(activeBase, drawOffset);
}

function restoreCleanStateForLayer(layer, drawOffset = { x: 0, y: 0 }) {
  if (!canvas || !ctx || !layer.cleanCanvasState) return;

  // We need to cache the temp canvas per layer, or recreate it. 
  // Let's just create a temporary canvas to draw the ImageData
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = layer.cleanCanvasState.width;
  tempCanvas.height = layer.cleanCanvasState.height;
  tempCanvas
    .getContext("2d")
    .putImageData(layer.cleanCanvasState, 0, 0);

  ctx.save();

  const dpr = window.devicePixelRatio || 1;
  ctx.drawImage(
    tempCanvas,
    drawOffset.x,
    drawOffset.y,
    tempCanvas.width / dpr,
    tempCanvas.height / dpr,
  );
  ctx.restore();
}

// --- Image Loading and Editing Functions ---
function handleCustomLayerUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const activeLayer = getActiveSticker();
  if (
    !activeLayer ||
    activeLayer.id === "base" ||
    activeLayer.id === "cutline" ||
    activeLayer.type === "text"
  ) {
    showNotification("Please select a Custom Layer first.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      activeLayer.originalImage = img;
      if (!activeLayer.alphaColorHex)
        activeLayer.alphaColorHex = alphaColorPicker
          ? alphaColorPicker.value
          : "#ffffff";
      if (!activeLayer.maskColorHex)
        activeLayer.maskColorHex = maskColorPicker
          ? maskColorPicker.value
          : "#000000";

      reprocessCustomLayer(activeLayer);
    };
    img.onerror = () => showNotification("Failed to load mask image.", "error");
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function reprocessCustomLayer(layer) {
  if (!layer.originalImage) return;

  const isCmyk = layer.type === "cmyk artwork" || layer.type === "cmyk";
  processCustomLayerMask(
    layer.originalImage,
    layer.alphaColorHex,
    layer.maskColorHex,
    !isCmyk,
  )
    .then((processedImg) => {
      layer.image = processedImg;
      redrawAll();
      showNotification(`Mask applied for ${layer.name}.`, "success");
    })
    .catch((err) => {
      console.error("Mask processing error:", err);
      showNotification("Failed to process mask.", "error");
    });
}

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
  showCanvasLoading(
    isMascot ? "Loading Mascot..." : "Loading Sticker Design...",
    "Reading file data",
  );

  // Hande API-based conversions for TIFF, PDF, and AI
  if (
    file.type === "image/tiff" ||
    file.type === "application/pdf" ||
    file.type === "application/postscript" ||
    file.name.toLowerCase().endsWith(".ai") ||
    file.name.toLowerCase().endsWith(".pdf") ||
    file.name.toLowerCase().endsWith(".tiff")
  ) {
    updateCanvasLoading("Converting File...", "Transforming to preview format");
    showNotification(
      "Converting file to preview format. This may take a moment...",
      "info",
    );
    const formData = new FormData();
    formData.append("file", file);

    fetch("/api/convert-image", {
      method: "POST",
      body: formData,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Conversion failed");
        return res.blob();
      })
      .then((blob) => {
        const convertedFile = new File([blob], file.name + ".png", {
          type: "image/png",
        });
        loadFileAsImage(convertedFile, isMascot);
      })
      .catch((err) => {
        console.error(err);
        hideCanvasLoading();
        showNotification("Failed to convert file format.", "error");
      });
    return;
  }

  // Handle SVGs differently from other images
  if (
    file.type === "image/svg+xml" ||
    file.name.toLowerCase().endsWith(".svg")
  ) {
    updateCanvasLoading("Parsing SVG...", "Extracting vector paths and print layers");

    let spawnX = 0;
    let spawnY = 0;
    const validExistingStickers = stickers.filter(
      (s) => s.image || s.originalImage || (s.basePolygons && s.basePolygons.length > 0)
    );
    if (validExistingStickers.length > 0) {
      let maxRight = 0;
      let minTop = Infinity;
      validExistingStickers.forEach((s) => {
        const sx = s.x || 0;
        const sy = s.y || 0;
        const sw = s.width || (s.image ? (s.image.naturalWidth || s.image.width) : (s.originalImage ? (s.originalImage.naturalWidth || s.originalImage.width) : 0));
        const sRight = sx + sw;
        if (sRight > maxRight) maxRight = sRight;
        if (sy < minTop) minTop = sy;
      });
      spawnX = maxRight;
      spawnY = minTop === Infinity ? 0 : minTop;
    }

    const newLayer = addSticker(
      null, // No raster image
      file.name || "Upload",
      spawnX,
      spawnY,
      baseCanvasWidth,
      baseCanvasHeight,
    );
    setActiveSticker(stickers.length - 1);
    
    reader.onload = (e) => {
      try {
        handleSvgUpload(e.target.result);
        renderLayerList();
      } catch (err) {
        console.error("SVG upload error:", err);
      } finally {
        hideCanvasLoading();
      }
    };
    reader.onerror = () => {
      hideCanvasLoading();
      showNotification("Error reading SVG file.", "error");
    };
    reader.readAsText(file);
  } else if (
    file.type.startsWith("image/") ||
    file.name.toLowerCase().endsWith(".png") ||
    file.name.toLowerCase().endsWith(".jpg") ||
    file.name.toLowerCase().endsWith(".jpeg")
  ) {
    updateCanvasLoading("Decoding Image...", "Preparing canvas and resolution");
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const activeTab = getActiveLineId() || "base";

        if (activeTab !== "base" && activeTab !== "cutline") {
          // Custom Layer Upload
          updateCanvasLoading("Processing Layer...", "Applying layer mask and color mapping");
          const customLayer = activeBase.customLayers.find((l) => l.id === activeTab);
          if (customLayer) {
            // Apply grayscale to the image
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext("2d");
            tempCtx.filter = "grayscale(100%)";
            tempCtx.drawImage(img, 0, 0);

            const processedImg = new Image();
            processedImg.onload = () => {
              customLayer.image = processedImg;
              showNotification(
                `Image loaded to ${customLayer.name} layer.`,
                "success",
              );
              redrawAllForHighlight();
              hideCanvasLoading();
            };
            processedImg.onerror = () => {
              hideCanvasLoading();
              showNotification("Failed to load processed layer image.", "error");
            };
            processedImg.src = tempCanvas.toDataURL();
          } else {
            hideCanvasLoading();
          }
          return; // Stop here, don't reset base design
        }

        // Base Layer Upload: position new sticker touching the right-most edge of existing stickers, top flush
        let spawnX = 0;
        let spawnY = 0;
        const validExistingStickers = stickers.filter(
          (s) => s.image || s.originalImage || (s.basePolygons && s.basePolygons.length > 0)
        );
        if (validExistingStickers.length > 0) {
          let maxRight = 0;
          let minTop = Infinity;
          validExistingStickers.forEach((s) => {
            const sx = s.x || 0;
            const sy = s.y || 0;
            const sw = s.width || (s.image ? (s.image.naturalWidth || s.image.width) : (s.originalImage ? (s.originalImage.naturalWidth || s.originalImage.width) : 0));
            const sRight = sx + sw;
            if (sRight > maxRight) maxRight = sRight;
            if (sy < minTop) minTop = sy;
          });
          spawnX = maxRight;
          spawnY = minTop === Infinity ? 0 : minTop;
        }

        updateCanvasLoading("Analyzing Image...", "Detecting contours & tracing cutlines");
        const newLayer = addSticker(
          img,
          file.name || "Upload",
          spawnX,
          spawnY,
          img.width,
          img.height,
        );
        setActiveSticker(stickers.length - 1);
        updateEditingButtonsState(false);
        renderLayerList();
        if (clearFileBtn) clearFileBtn.classList.remove("hidden");
        showNotification("Image loaded successfully.", "success");
        let newWidth = img.width;
        let newHeight = img.height;
        if (canvas && ctx) {
          setCanvasSize(newWidth, newHeight);
          ctx.clearRect(0, 0, newWidth, newHeight);
          ctx.drawImage(activeBase.originalImage, 0, 0, newWidth, newHeight);

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

          // --- AUTO WHITE UNDERBASE GENERATION ---
          if (pricingConfig && pricingConfig.layers) {
            // Check if material supports white layer and we don't already have one
            const hasWhiteLayer = activeBase.customLayers.some(
              (l) => l.type.toLowerCase() === "white",
            );
            const supportsWhite = pricingConfig.layers.some(
              (l) => l.name.toLowerCase() === "white",
            );

            if (supportsWhite && !hasWhiteLayer) {
              const whiteLayer = {
                id: `custom_${Date.now()}_${Math.floor(
                  Math.random() * 1000,
                )}`,
                name: "White Layer",
                type: "white",
                image: null,
                originalImage: null,
                visible: true,
                alphaColorHex: "#ffffff",
                maskColorHex: "#000000",
              };

              const pricingLayer = pricingConfig.layers.find(
                (l) => l.name.toLowerCase() === "white",
              );
              if (
                pricingLayer &&
                pricingLayer.subTypes &&
                pricingLayer.subTypes.length > 0
              ) {
                whiteLayer.subType = pricingLayer.subTypes[0].id;
              }

              activeBase.customLayers.push(whiteLayer);
              renderLayerTabs();
              calculateAndUpdatePrice();

              processCustomLayerMask(
                activeBase.originalImage,
                "underbase",
                "#ffffff",
                true,
              )
                .then((processedImg) => {
                  whiteLayer.image = processedImg;
                  redrawAll();
                  showNotification(
                    "Auto-generated White Underbase layer.",
                    "info",
                  );
                })
                .catch((err) => {
                  console.error("Auto mask generation failed:", err);
                });
            }
          }

          // Generate cutline based on image transparency
          const currentImageData = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );

          if (imageHasTransparentBorder(currentImageData)) {
            if (cutShapeSelect) cutShapeSelect.value = "trace";
            handleGenerateCutline(true);
          } else {
            if (cutShapeSelect) cutShapeSelect.value = "square";
            handleGenerateCutline(true);
          }

          activeBase.currentPolygons = []; // Clear any previous SVG data

          // Show the legend tabs since an image is loaded
          renderLayerTabs();
        } else {
          hideCanvasLoading();
        }
      };
      img.onerror = () => {
        hideCanvasLoading();
        showNotification("Error loading image data.", "error");
      };
      img.src = reader.result;
    };
    reader.onerror = () => {
      hideCanvasLoading();
      showNotification("Error reading file.", "error");
    };
    reader.readAsDataURL(file);
  } else {
    hideCanvasLoading();
    showNotification(
      "Invalid file type. Please select an image or SVG file.",
      "error",
    );
  }
}

let redrawPending = false;
function redrawAll() {
  if (redrawPending) return;
  redrawPending = true;
  requestAnimationFrame(() => {
    redrawPending = false;
    doRedrawAll();
  });
}

function doRedrawAll() {
  // Ensure active line ID matches DOM state if applicable
  const lazyLassoSlider = document.getElementById("lazyLassoSlider");
  const currentLassoRadius =
    lazyLassoSlider && lazyLassoSlider.value
      ? parseInt(lazyLassoSlider.value, 10)
      : 50;



  generateOrganicSheetBoundary();

  // 2. Compute Global Bounding Box across all layers
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasContent = false;

  stickers.forEach((layer) => {
    if (layer.currentCutline && layer.currentCutline.length > 0 && layer.visible !== false) {
      const bounds = getPolygonsBounds(layer.currentCutline);
      const absLeft = bounds.left + (layer.x || 0);
      const absRight = bounds.right + (layer.x || 0);
      const absTop = bounds.top + (layer.y || 0);
      const absBottom = bounds.bottom + (layer.y || 0);

      if (absLeft < minX) minX = absLeft;
      if (absRight > maxX) maxX = absRight;
      if (absTop < minY) minY = absTop;
      if (absBottom > maxY) maxY = absBottom;
      hasContent = true;
    } else if ((layer.originalImage || layer.image) && layer.visible !== false) {
      // Fallback to image bounds if no cutline
      const img = layer.image || layer.originalImage;
      const absLeft = layer.x || 0;
      const absRight = absLeft + (layer.width || img.width);
      const absTop = layer.y || 0;
      const absBottom = absTop + (layer.height || img.height);

      if (absLeft < minX) minX = absLeft;
      if (absRight > maxX) maxX = absRight;
      if (absTop < minY) minY = absTop;
      if (absBottom > maxY) maxY = absBottom;
      hasContent = true;
    }
  });

  if (!hasContent) {
    minX = 0;
    minY = 0;
    maxX = baseCanvasWidth;
    maxY = baseCanvasHeight;
  }

  if (organicSheetCutline && organicSheetCutline.length > 0) {
    currentBounds = getPolygonsBounds(organicSheetCutline);
  } else {
    currentBounds = {
      left: minX,
      top: minY,
      right: maxX,
      bottom: maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  // --- VALIDATION ---
  if (
    currentBounds.right - currentBounds.left <= 0 ||
    currentBounds.bottom - currentBounds.top <= 0
  ) {
    console.error("Invalid bounds calculated, aborting redraw.", currentBounds);
    return;
  }

  // 3. Set canvas size and padding
  let ppi = 300;
  if (
    typeof pricingConfig !== "undefined" &&
    pricingConfig &&
    typeof stickerResolutionSelect !== "undefined" &&
    stickerResolutionSelect
  ) {
    const selectedRes = pricingConfig.resolutions.find(
      (r) => r.id === (stickerResolutionSelect.value || "dpi_300")
    );
    if (selectedRes) ppi = selectedRes.ppi;
  }
  const ppiScale = ppi / 96;
  const scale = Math.max(currentBounds.width, currentBounds.height) / 500;
  const padding = Math.max(Math.round(60 * ppiScale), Math.round(40 * scale));

  const logicalWidth = currentBounds.width + padding * 2;
  const logicalHeight = currentBounds.height + padding * 2;

  const dpr = window.devicePixelRatio || 1;
  const targetPhysicalWidth = Math.round(logicalWidth * dpr);
  const targetPhysicalHeight = Math.round(logicalHeight * dpr);

  if (
    Math.round(canvas.width) !== targetPhysicalWidth ||
    Math.round(canvas.height) !== targetPhysicalHeight
  ) {
    setCanvasSize(logicalWidth, logicalHeight);
  }

  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

  const drawOffset = {
    x: -currentBounds.left + padding,
    y: -currentBounds.top + padding,
  };

  // Fill entire canvas with white for the ruler/padding area
  ctx.save();
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

  // Cut out the organic sheet boundary so the CSS background (Magenta/Black) shows through
  if (organicSheetCutline && organicSheetCutline.length > 0) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    organicSheetCutline.forEach((poly) => {
      if (!poly || poly.length === 0) return;
      ctx.moveTo(poly[0].x + drawOffset.x, poly[0].y + drawOffset.y);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i].x + drawOffset.x, poly[i].y + drawOffset.y);
      }
      ctx.closePath();
    });
    ctx.fill();
  }
  ctx.restore();

  drawCanvasDecorations(currentBounds, drawOffset);
  
  // After redrawing, the bounds may have changed, so update the price.
  calculateAndUpdatePrice();
  updateLegend();
}

function updateLegend() {
  const legendDiv = document.getElementById("cutline-legend");
  const legendList = document.getElementById("cutline-legend-list");
  if (!legendDiv || !legendList) return;

  if (stickers.length === 0) {
    legendDiv.style.opacity = "0";
    setTimeout(() => { if(stickers.length === 0) legendDiv.style.display = "none"; }, 300);
    return;
  }

  legendDiv.style.display = "block";
  requestAnimationFrame(() => {
    legendDiv.style.opacity = "1";
  });

  let html = "";
  
  if (stickers.length === 1) {
    html += `
      <li class="flex items-center gap-2">
        <div class="w-6 h-0 border-t-2 border-cyan-400"></div>
        <span>Kiss Cut</span>
      </li>
      <li class="flex items-center gap-2">
        <div class="w-6 h-0 border-t-2 border-red-500"></div>
        <span>Sheet Boundary (Die Cut)</span>
      </li>
    `;
  } else if (activeStickerIndex === 'boundary') {
     html += `
      <li class="flex items-center gap-2">
        <div class="w-6 h-0 border-t-2 border-dashed border-cyan-400 opacity-50"></div>
        <span>Kiss Cut (All Stickers)</span>
      </li>
      <li class="flex items-center gap-2">
        <div class="w-6 h-0 border-t-2 border-red-500"></div>
        <span>Sheet Boundary (Die Cut)</span>
      </li>
    `;
  } else {
    html += `
      <li class="flex items-center gap-2">
        <div class="w-6 h-0 border-t-2 border-cyan-400"></div>
        <span>Kiss Cut (Active Sticker)</span>
      </li>
      <li class="flex items-center gap-2">
        <div class="w-6 h-0 border-t-2 border-dashed border-cyan-400 opacity-50"></div>
        <span>Kiss Cut (Other Stickers)</span>
      </li>
      <li class="flex items-center gap-2">
        <div class="w-6 h-0 border-t-2 border-dashed border-red-500 opacity-50"></div>
        <span>Sheet Boundary (Die Cut)</span>
      </li>
    `;
  }

  legendList.innerHTML = html;
}

function handleSvgUpload(svgText) {
  const parser = new SVGParser();
  try {
    parser.load(svgText);
    parser.cleanInput();

    const knownLayerTypes =
      pricingConfig && pricingConfig.layers
        ? pricingConfig.layers.map((l) => l.name.toLowerCase())
        : ["white", "cmyk", "clear"];
    const normalizeName = (name) =>
      name
        .toLowerCase()
        .replace(/[\s_]+/g, "")
        .replace("underbase", "")
        .replace("layer", "")
        .trim();

    const extractedLayers = {};
    const basePolygonsElements = [];

    Array.from(parser.svgRoot.children).forEach((child) => {
      let layerName = null;
      if (child.id) layerName = child.id;
      else if (child.getAttribute("data-name"))
        layerName = child.getAttribute("data-name");

      let matchedType = null;
      if (layerName) {
        const normalized = normalizeName(layerName);
        matchedType = knownLayerTypes.find(
          (type) =>
            normalized.includes(type.toLowerCase()) ||
            type.toLowerCase().includes(normalized),
        );
      }

      if (matchedType) {
        if (!extractedLayers[matchedType]) extractedLayers[matchedType] = [];
        if (child.tagName.toLowerCase() === "g") {
          extractedLayers[matchedType].push(
            ...child.querySelectorAll(
              "path, rect, circle, ellipse, polygon, polyline",
            ),
          );
        } else {
          if (
            [
              "path",
              "rect",
              "circle",
              "ellipse",
              "polygon",
              "polyline",
            ].includes(child.tagName.toLowerCase())
          ) {
            extractedLayers[matchedType].push(child);
          }
        }
      } else {
        if (child.tagName.toLowerCase() === "g") {
          basePolygonsElements.push(
            ...child.querySelectorAll(
              "path, rect, circle, ellipse, polygon, polyline",
            ),
          );
        } else {
          if (
            [
              "path",
              "rect",
              "circle",
              "ellipse",
              "polygon",
              "polyline",
            ].includes(child.tagName.toLowerCase())
          ) {
            basePolygonsElements.push(child);
          }
        }
      }
    });

    const polygons = [];
    basePolygonsElements.forEach((element) => {
      // polygonify will convert each shape to an array of points
      const poly = parser.polygonify(element);
      if (poly && poly.length > 0) {
        polygons.push(poly);
      }
    });

    if (polygons.length === 0 && Object.keys(extractedLayers).length === 0) {
      throw new Error("No parsable shapes found in the SVG.");
    }

    // Store the results globally
    if (polygons.length > 0) {
      activeBase.basePolygons = polygons; // Store the original, unscaled polygons
      activeBase.currentPolygons = polygons;
    } else {
      activeBase.basePolygons = [];
      activeBase.currentPolygons = [];
    }

    const bounds = getPolygonsBounds(polygons);
    setCanvasSize(bounds.width, bounds.height);

    // Generate the cutline
    if (polygons.length > 0) {
      let cutline = generateCutLine(
        polygons,
        activeBase.cutlineOffset !== undefined ? activeBase.cutlineOffset : 15,
      ); // Use dynamic offset
      cutline = clipPolygonToBoundingBox(
        cutline,
        baseCanvasWidth,
        baseCanvasHeight,
      );
      activeBase.currentCutline = cutline;
      currentBounds = getPolygonsBounds(cutline);
    } else {
      activeBase.currentCutline = [];
    }

    // Process custom layers
    Object.keys(extractedLayers).forEach((type) => {
      // Add custom layer to the stack
      const newLayer = {
        id: `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: type.charAt(0).toUpperCase() + type.slice(1) + " Layer",
        type: type,
        image: null,
        visible: true,
      };

      // Try to match pricing config subtype
      if (pricingConfig && pricingConfig.layers) {
        const pricingLayer = pricingConfig.layers.find(
          (l) => l.name.toLowerCase() === type,
        );
        if (
          pricingLayer &&
          pricingLayer.subTypes &&
          pricingLayer.subTypes.length > 0
        ) {
          newLayer.subType = pricingLayer.subTypes[0].id;
        }
      }

      activeBase.customLayers.push(newLayer);

      // Render the SVG shapes to an offscreen canvas for the custom layer's image
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = baseCanvasWidth;
      tempCanvas.height = baseCanvasHeight;
      const tempCtx = tempCanvas.getContext("2d");
      
      const layerPolygons = [];
      extractedLayers[type].forEach((element) => {
        const poly = parser.polygonify(element);
        if (poly && poly.length > 0) {
           layerPolygons.push(poly);
        }
      });
      
      if (layerPolygons.length > 0) {
         // Center them exactly as we do for the main image
         const layerBounds = getPolygonsBounds(layerPolygons);
         const scale =
           Math.min(
             baseCanvasWidth / layerBounds.width,
             baseCanvasHeight / layerBounds.height,
           ) * 0.9;
         const offsetX =
           baseCanvasWidth / 2 - (layerBounds.left + layerBounds.width / 2) * scale;
         const offsetY =
           baseCanvasHeight / 2 -
           (layerBounds.top + layerBounds.height / 2) * scale;

         tempCtx.fillStyle = "black"; // Masks are usually drawn in black for CMYK or White
         layerPolygons.forEach((poly) => {
           tempCtx.beginPath();
           poly.forEach((pt, idx) => {
             const x = pt.X * scale + offsetX;
             const y = pt.Y * scale + offsetY;
             if (idx === 0) tempCtx.moveTo(x, y);
             else tempCtx.lineTo(x, y);
           });
           tempCtx.closePath();
           tempCtx.fill();
         });
      }

      const img = new Image();
      img.onload = () => {
        newLayer.originalImage = img;
        newLayer.image = img;
        redrawAll();
      };
      img.src = tempCanvas.toDataURL();
    });

    renderLayerTabs();
    redrawAll();

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
    renderLayerTabs();
  } catch (error) {
    showNotification(`SVG Processing Error: ${error.message}`, "error");
    console.error(error);
  }
}

function clipPolygonToBoundingBox(polygons, boxWidth, boxHeight) {
  if (!polygons || polygons.length === 0) return [];
  const scale = 100;

  // Create clipping box polygon
  // Apply image offset to the clipping box so it clips correctly relative to the local cutline coordinates
  const clipBox = [
    { X: 0, Y: 0 },
    { X: Math.round(boxWidth * scale), Y: 0 },
    { X: Math.round(boxWidth * scale), Y: Math.round(boxHeight * scale) },
    { X: 0, Y: Math.round(boxHeight * scale) },
  ];

  const clipper = new ClipperLib.Clipper();

  // Add subject paths (the offset cutline)
  const subjPaths = [];
  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    const newPoly = new Array(p.length);
    for (let j = 0; j < p.length; j++) {
      newPoly[j] = {
        X: Math.round(p[j].x * scale),
        Y: Math.round(p[j].y * scale),
      };
    }
    subjPaths.push(newPoly);
  }

  clipper.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath([clipBox], ClipperLib.PolyType.ptClip, true);

  const solution = new ClipperLib.Paths();
  clipper.Execute(ClipperLib.ClipType.ctIntersection, solution);

  // Convert back to normal scale
  const result = new Array(solution.length);
  for (let i = 0; i < solution.length; i++) {
    const p = solution[i];
    const newPoly = new Array(p.length);
    for (let j = 0; j < p.length; j++) {
      newPoly[j] = { x: p[j].X / scale, y: p[j].Y / scale };
    }
    result[i] = newPoly;
  }

  return result;
}

const scaledPolyCache = new WeakMap();

let currentOffsetMessageId = 0;

function generateCutLineAsync(polygons, rawOffset, rawLazyRadius = 0) {
  return new Promise((resolve, reject) => {
    if (!polygons || polygons.length === 0) {
      resolve([]);
      return;
    }

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
    const offsetMm = rawOffset / 10;
    const lazyRadiusMm = rawLazyRadius / 10;

    // Convert mm to logical pixels using the current PPI
    const offsetPx = (offsetMm / 25.4) * ppi;
    const lazyRadiusPx = (lazyRadiusMm / 25.4) * ppi;

    const messageId = ++currentOffsetMessageId;

    let timeoutId;
    const handleMessage = function (e) {
      if (e.data.messageId !== messageId) return; // Ignore old messages
      clearTimeout(timeoutId);
      offsetWorker.removeEventListener("message", handleMessage);

      if (e.data.success) {
        console.log("BROWSER LOG: offsetWorker SUCCESS:", e.data.workerLogs);
        resolve(e.data.cutline);
      } else {
        console.warn("offsetWorker error, using sync fallback:", e.data.error);
        resolve(generateCutLine(polygons, rawOffset, rawLazyRadius));
      }
    };

    // Safety timeout: fall back to synchronous calculation if worker takes > 2500ms
    timeoutId = setTimeout(() => {
      offsetWorker.removeEventListener("message", handleMessage);
      console.warn("offsetWorker timed out, executing synchronous cutline fallback");
      try {
        const fallback = generateCutLine(polygons, rawOffset, rawLazyRadius);
        resolve(fallback);
      } catch (err) {
        reject(err);
      }
    }, 2500);

    offsetWorker.addEventListener("message", handleMessage);

    offsetWorker.postMessage({
      messageId: messageId,
      polygons: polygons,
      offsetAmount: offsetPx,
      lassoRadius: lazyRadiusPx,
    });
  });
}

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
  const joinType =
    offsetPx <= 0 ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound;

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
    co3.AddPaths(shrunk_paths, joinType, ClipperLib.EndType.etClosedPolygon);
    co3.Execute(final_paths, Math.round(offsetPx * scale));
  } else {
    // Normal single-pass offset
    const co = new ClipperLib.ClipperOffset(10, 0.25);
    final_paths = new ClipperLib.Paths();
    co.AddPaths(scaledPolygons, joinType, ClipperLib.EndType.etClosedPolygon);
    co.Execute(final_paths, Math.round(offsetPx * scale));
  }

  // Removed filter for positive offsets to allow disconnected sticker components
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

  console.log("BROWSER LOG: generateCutLine sync - input length:", polygons.length, "output length:", cutline.length);

  return cutline;
}

function drawPolygonsToCanvas(
  polygons,
  style,
  offset = { x: 0, y: 0 },
  stroke = false,
  isActive = false
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
    ctx.strokeStyle = style;

    // Constant hairline width
    const baseLineWidth = getConstantLineWidth(isActive ? 3.0 : 1.5);
    ctx.lineWidth = baseLineWidth;

    if (!isActive) {
      ctx.globalAlpha = 0.5; // Dim when not active
      ctx.setLineDash([getConstantLineWidth(4), getConstantLineWidth(4)]); // Dashed
    } else {
      ctx.globalAlpha = 1.0;
      ctx.setLineDash([]); // Solid
    }

    ctx.stroke();
    ctx.setLineDash([]); // Reset for other drawing operations
    ctx.globalAlpha = 1.0; // Reset
  } else {
    ctx.fillStyle = style;
    ctx.fill();
  }
  ctx.restore();
}

function drawCanvasDecorations(bounds, offset = { x: 0, y: 0 }, customImageToDraw = null) {
  if (!bounds || stickers.length === 0) return;

  const dpr = window.devicePixelRatio || 1;

  // Combine Pass 1 (White Vinyl) and Pass 2 (Base Images) to fix stacking order
  const bColor1 = document.getElementById("bleedColor1")?.value || "#000000";
  const bColor2 = document.getElementById("bleedColor2")?.value || "#000000";

  stickers.forEach((layer) => {
    if (layer.visible !== false) {
      // 1. Draw White Vinyl Background (Bleed)
      if (layer.currentCutline && layer.currentCutline.length > 0) {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.beginPath();
        layer.currentCutline.forEach((poly) => {
          if (!poly || poly.length === 0) return;
          ctx.moveTo(
            poly[0].x + offset.x + (layer.x || 0),
            poly[0].y + offset.y + (layer.y || 0)
          );
          for (let i = 1; i < poly.length; i++)
            ctx.lineTo(
              poly[i].x + offset.x + (layer.x || 0),
              poly[i].y + offset.y + (layer.y || 0)
            );
          ctx.closePath();
        });

        // Fill with white first
        ctx.fillStyle = "white";
        ctx.fill();

        // Stroke with bleed gradient
        const cutBounds = getPolygonsBounds(layer.currentCutline);
        const gradient = ctx.createLinearGradient(
          cutBounds.left + offset.x + (layer.x || 0),
          cutBounds.top + offset.y + (layer.y || 0),
          cutBounds.right + offset.x + (layer.x || 0),
          cutBounds.bottom + offset.y + (layer.y || 0)
        );
        gradient.addColorStop(0, bColor1);
        gradient.addColorStop(1, bColor2);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 20;
        ctx.stroke();
        ctx.restore();
      }

      // 2. Draw Base Images & Polygons
      if (layer.currentPolygons && layer.currentPolygons.length > 0) {
        // Vector mode base drawing
        const layerOffset = {
          x: offset.x + (layer.x || 0),
          y: offset.y + (layer.y || 0)
        };
        drawPolygonsToCanvas(layer.currentPolygons, "black", layerOffset);
      } else {
        const img = layer.image || layer.originalImage;
        if (img) {
          ctx.save();
          // Clip the image to its cutline so any JPEG white background outside the cutline is hidden
          if (layer.currentCutline && layer.currentCutline.length > 0) {
            ctx.beginPath();
            layer.currentCutline.forEach((poly) => {
              if (!poly || poly.length === 0) return;
              ctx.moveTo(
                poly[0].x + offset.x + (layer.x || 0),
                poly[0].y + offset.y + (layer.y || 0)
              );
              for (let i = 1; i < poly.length; i++) {
                ctx.lineTo(
                  poly[i].x + offset.x + (layer.x || 0),
                  poly[i].y + offset.y + (layer.y || 0)
                );
              }
              ctx.closePath();
            });
            ctx.clip();
          }

          const layerWidth = layer.width || (img.naturalWidth || img.width);
          const layerHeight = layer.height || (img.naturalHeight || img.height);
          const imgX = offset.x + (layer.x || 0);
          const imgY = offset.y + (layer.y || 0);

          ctx.drawImage(img, imgX, imgY, layerWidth, layerHeight);
          ctx.restore();
        }
      }
    }
  });

  // Pass 3: Draw Custom Print Layers (Holographic, Spot Gloss, etc.)
  stickers.forEach((sticker) => {
    if (sticker.visible !== false && sticker.layerOrder && sticker.customLayers) {
      sticker.layerOrder.forEach((layerId) => {
        if (layerId !== "base" && layerId !== "cutline") {
          const customLayer = sticker.customLayers.find((l) => l.id === layerId);
          if (customLayer && customLayer.image) {
            // White underbase sits under the ink in production.
            // Only draw white layer mask over canvas when the user is actively viewing/inspecting that tab.
            if (customLayer.type === "white" && selectedLegendTab !== customLayer.id) {
              return;
            }
            ctx.save();
            const layerWidth = sticker.width || (sticker.image && (sticker.image.naturalWidth || sticker.image.width)) || 0;
            const layerHeight = sticker.height || (sticker.image && (sticker.image.naturalHeight || sticker.image.height)) || 0;
            if (layerWidth > 0 && layerHeight > 0) {
              if (selectedLegendTab === customLayer.id) {
                ctx.globalAlpha = 0.85;
              }
              ctx.drawImage(
                customLayer.image,
                offset.x + (sticker.x || 0),
                offset.y + (sticker.y || 0),
                layerWidth,
                layerHeight
              );
            }
            ctx.restore();
          }
        }
      });
    }
  });

  // Pass 4: Draw All Kiss Cuts (Cyan)
  stickers.forEach((layer, index) => {
    const isSelected = activeStickerIndex === index;
    const isSvgLayer = !layer.image && !layer.originalImage;
    // 1) The layer is selected OR 2) It is the cutline layer and we want to draw it based on layerOrder OR 3) it's an SVG and we always draw it
    const shouldDraw = (typeof activeBase.layerOrder !== "undefined" && activeBase.layerOrder.includes("cutline")) || isSelected || isSvgLayer;
    
    if (shouldDraw && layer.currentCutline && layer.currentCutline.length > 0 && layer.visible !== false) {
      const layerOffset = {
        x: offset.x + (layer.x || 0),
        y: offset.y + (layer.y || 0),
      };
      drawPolygonsToCanvas(
        layer.currentCutline,
        "cyan",
        layerOffset,
        true,
        isSelected
      );
    }
  });

  // Pass 5: Draw Sheet Boundary (Die Cut - Red)
  if (organicSheetCutline) {
    drawPolygonsToCanvas(
      organicSheetCutline,
      "red",
      offset,
      true,
      activeStickerIndex === 'boundary'
    );
  }

  drawBoundingBox(bounds, offset);
  
  // Draw dimensions and ruler
  if (typeof drawRuler === 'function') {
      drawRuler(bounds, offset);
  }
  if (typeof drawSizeIndicator === 'function') {
      drawSizeIndicator(bounds, offset);
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

  // Set color to light grey as a subtle backdrop for the measurement guides.
  ctx.strokeStyle = "rgba(128, 128, 128, 0.4)"; // Faint grey

  // Constant hairline width
  const baseLineWidth = getConstantLineWidth(isBoxActive ? 2.0 : 1.0);
  ctx.lineWidth = baseLineWidth;

  if (isOtherActive) {
    ctx.globalAlpha = 0.3;
  } else {
    ctx.globalAlpha = 1.0;
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

  // Scale the font size relative to the bounds so it's readable on large images
  const scale = Math.max(bounds.width, bounds.height) / 500;
  const fontSize = Math.max(16, Math.round(18 * scale));

  // Add a slight drop shadow so it stands out against any background
  ctx.save();
  ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  // Position the text slightly above the top edge of the bounding box
  // Position the text slightly above the top edge of the bounding box and outside the ruler
  const x = bounds.left + offset.x + bounds.width / 2;
  const y = bounds.top + offset.y - Math.max(30, 40 * scale);
  ctx.fillText(`${width.toFixed(1)} ${unit}`, x, y);

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  // Position the text slightly to the left of the left edge, rotated
  // Position the text slightly to the left of the left edge and outside the ruler, rotated
  const leftX = bounds.left + offset.x - Math.max(30, 45 * scale);
  const leftY = bounds.top + offset.y + bounds.height / 2;

  ctx.translate(leftX, leftY);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${height.toFixed(1)} ${unit}`, 0, 0);
  ctx.restore();
}

let layerTabsInitialized = false;
// Removed global printInks
// globalLayerOrder replaced by activeBase.layerOrder
let sortableInstance = null;

function renderLayerTabs() {
  const layerTabsContainer = document.getElementById("print-ink-tabs");
  if (!layerTabsContainer) return;

  layerTabsContainer.style.display = "flex";

  const container = document.getElementById("print-ink-tabs-container");
  if (container) {
    if (stickers.length > 0 && activeStickerIndex !== 'boundary') {
       container.style.display = "flex";
    } else {
       container.style.display = "none";
    }
  }

  const customLayers = (activeBase && Array.isArray(activeBase.customLayers)) ? activeBase.customLayers : [];
  const tabs = [
    {
      id: "base",
      label: "Base Design",
      color: "#4f46e5", // Indigo
      borderColor: "#4f46e5",
      bgColor: "#e0e7ff",
    },
    {
      id: "cutline",
      label: "Cutline",
      color: "red",
      borderColor: "#ef4444",
      bgColor: "#fee2e2",
    },
    ...customLayers.map((layer) => ({
      id: layer.id,
      label: layer.name,
      color: "#4b5563",
      borderColor: "#6b7280",
      bgColor: "#f3f4f6",
    })),
  ];

  layerTabsContainer.innerHTML = ""; // Always rebuild to handle dynamic tabs

  if (!activeBase.layerOrder || !Array.isArray(activeBase.layerOrder)) {
    activeBase.layerOrder = ["base", "cutline"];
  }

  // Ensure activeBase.layerOrder contains all current tabs and no stale tabs
  const tabIds = tabs.map((t) => t.id);
  activeBase.layerOrder = activeBase.layerOrder.filter((id) => tabIds.includes(id));
  tabIds.forEach((id) => {
    if (!activeBase.layerOrder.includes(id)) {
      activeBase.layerOrder.push(id);
    }
  });

  // Sort tabs array to match activeBase.layerOrder for visual rendering
  const sortedTabs = activeBase.layerOrder
    .map((id) => tabs.find((t) => t.id === id))
    .filter(Boolean);

  sortedTabs.forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `print-ink-tab-${tab.id}`;
    btn.className = `px-3 py-1 text-xs font-semibold rounded-t-lg transition-colors border-2 border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 flex items-center gap-1 cursor-grab active:cursor-grabbing select-none`;
    btn.setAttribute("data-id", tab.id);

    // Default style
    btn.style.color = tab.color;
    btn.style.borderColor = tab.borderColor;
    btn.style.fontFamily = "var(--font-baumans)";
    btn.textContent = tab.label;

    if (tab.id !== "base" && tab.id !== "cutline") {
      // Add a delete button for custom layers
      const deleteBtn = document.createElement("span");
      deleteBtn.textContent = "×";
      deleteBtn.className =
        "text-gray-500 hover:text-red-500 ml-2 rounded-full px-1 cursor-pointer";
      deleteBtn.title = "Delete Layer";
      deleteBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent tab click
        deleteCustomLayer(tab.id);
      };
      btn.appendChild(deleteBtn);
    }

    // Interactivity
    btn.addEventListener("mouseenter", () => {
      hoveredLegendTab = tab.id;
      updateLayerTabsStyles();
      redrawAllForHighlight();
    });

    btn.addEventListener("mouseleave", () => {
      if (hoveredLegendTab === tab.id) {
        hoveredLegendTab = null;
        updateLayerTabsStyles();
        redrawAllForHighlight();
      }
    });

    btn.addEventListener("click", () => {
      console.log(`[CLIENT] Tab clicked: ${tab.id}`);
      if (selectedLegendTab === tab.id) {
        // Toggle off - default to base
        selectedLegendTab = "base";
      } else {
        selectedLegendTab = tab.id;
      }
      console.log(`[CLIENT] selectedLegendTab is now: ${selectedLegendTab}`);
      updateLayerTabsStyles();
      redrawAllForHighlight();
      updateEditingControlsForActiveLayer();
    });

    layerTabsContainer.appendChild(btn);
  });

  // Add the "+" tab
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = `px-3 py-1 text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 border-2 border-gray-300 border-b-0 rounded-t-lg transition-colors`;
  addBtn.textContent = "+";
  addBtn.title = "Add Specialty Ink or Mask";
  addBtn.classList.add("add-sticker-btn"); // Add a class so Sortable can ignore it

  // Create Dropdown Container
  const dropdownContainer = document.createElement("div");
  dropdownContainer.className = "ignore-drag add-sticker-btn";
  dropdownContainer.style.position = "relative";
  dropdownContainer.style.display = "inline-block";

  // Create Dropdown Menu
  const dropdownMenu = document.createElement("div");
  dropdownMenu.className = "layer-dropdown-menu";
  dropdownMenu.style.display = "none";
  dropdownMenu.style.position = "absolute";
  dropdownMenu.style.backgroundColor = "white";
  dropdownMenu.style.boxShadow = "0px 8px 16px 0px rgba(0,0,0,0.2)";
  dropdownMenu.style.zIndex = "1";
  dropdownMenu.style.minWidth = "120px";
  dropdownMenu.style.borderRadius = "4px";
  dropdownMenu.style.overflow = "hidden";
  dropdownMenu.style.top = "100%";
  dropdownMenu.style.left = "0";

  // Fallback options in case pricingConfig isn't loaded
  let layerOptions = ["White", "Clear", "Inlay", "Text", "CMYK Artwork"];
  if (
    typeof pricingConfig !== "undefined" &&
    pricingConfig &&
    pricingConfig.layers
  ) {
    layerOptions = pricingConfig.layers.map((l) => l.name);
  }

  layerOptions.forEach((optionText) => {
    const option = document.createElement("a");
    option.textContent = optionText;
    option.href = "#";
    option.style.color = "black";
    option.style.padding = "8px 12px";
    option.style.textDecoration = "none";
    option.style.display = "block";
    option.style.fontSize = "12px";

    option.onmouseover = () => (option.style.backgroundColor = "#f1f1f1");
    option.onmouseout = () => (option.style.backgroundColor = "white");

    option.onclick = (e) => {
      e.preventDefault();
      addCustomLayer(optionText);
      dropdownMenu.style.display = "none";
    };
    dropdownMenu.appendChild(option);
  });

  addBtn.onclick = (e) => {
    e.stopPropagation();
    dropdownMenu.style.display =
      dropdownMenu.style.display === "block" ? "none" : "block";
  };

  // Close the dropdown if the user clicks outside of it
  document.addEventListener("click", function (event) {
    if (dropdownContainer && !dropdownContainer.contains(event.target)) {
      dropdownMenu.style.display = "none";
    }
  });

  dropdownContainer.appendChild(addBtn);
  dropdownContainer.appendChild(dropdownMenu);
  layerTabsContainer.appendChild(dropdownContainer);

  // Initialize SortableJS
  if (sortableInstance) {
    sortableInstance.destroy();
  }

  sortableInstance = new Sortable(layerTabsContainer, {
    animation: 150,
    filter: ".add-sticker-btn, .ignore-drag", // Don't allow dragging the + button
    onMove: function (evt) {
      if (
        evt.related &&
        (evt.related.classList.contains("add-sticker-btn") ||
          evt.related.classList.contains("ignore-drag"))
      ) {
        return false;
      }
      return true;
    },
    onEnd: function (evt) {
      // Rebuild activeBase.layerOrder based on the new DOM order
      const newOrder = [];
      const children = layerTabsContainer.children;
      for (let i = 0; i < children.length; i++) {
        const id = children[i].getAttribute("data-id");
        if (id) newOrder.push(id);
      }
      activeBase.layerOrder = newOrder;
      redrawAll();
    },
  });

  // Default to base design tab if nothing selected
  if (!selectedLegendTab) {
    selectedLegendTab = "base";
  }

  updateLayerTabsStyles();
  updateEditingControlsForActiveLayer();
}

function updateLayerTabsStyles() {
  const layerTabsContainer = document.getElementById("print-ink-tabs");
  if (!layerTabsContainer) return;
  const tabs = [
    { id: "base", bgColor: "#e0e7ff" },
    { id: "cutline", bgColor: "#fee2e2" },
    ...activeBase.customLayers.map((layer) => ({ id: layer.id, bgColor: "#f3f4f6" })),
  ];

  tabs.forEach((tab) => {
    const btn = document.getElementById(`print-ink-tab-${tab.id}`);
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

function updateEditingControlsForActiveLayer() {
  const activeTabId = getActiveLineId() || "base";
  console.log("[CLIENT] updateEditingControlsForActiveLayer called. activeTabId:", activeTabId);

  const baseControls = document.querySelector(".control-group-base");
  const cutlineControls = document.querySelector(".control-group-cutline");
  const customControls = document.querySelector(".control-group-custom");

  if (baseControls)
    baseControls.style.display = (activeTabId === "base" && activeStickerIndex !== 'boundary') ? "flex" : "none";
  if (cutlineControls)
    cutlineControls.style.display = (activeTabId === "cutline" && activeStickerIndex !== 'boundary') ? "flex" : "none";
  if (customControls)
    customControls.style.display = (activeTabId !== "base" && activeTabId !== "cutline" && activeStickerIndex !== 'boundary') ? "block" : "none";

  if (activeStickerIndex === 'boundary') {
      return; // Skip slider updates for boundary
  }
  if (activeBase) {
    if (cutlineOffsetSlider) {
      let step = 1; // Default
      if (activeBase.cutlineOffset === 0) step = 0;
      else if (activeBase.cutlineOffset === 15) step = 1;
      else if (activeBase.cutlineOffset === 35) step = 2;
      cutlineOffsetSlider.value = step;
      if (cutlineOffsetValueDisplay) {
        cutlineOffsetValueDisplay.textContent = step === 0 ? "0mm (None)" : step === 1 ? "1.5mm" : "3mm";
      }
    }
    if (cutlineSensitivitySlider) {
      cutlineSensitivitySlider.value = activeBase.cutlineSensitivity !== undefined ? activeBase.cutlineSensitivity : 42;
      if (cutlineSensitivityValueDisplay) {
        cutlineSensitivityValueDisplay.textContent = cutlineSensitivitySlider.value;
      }
    }
    if (lazyLassoSlider) {
      lazyLassoSlider.value = activeBase.lazyLassoRadius !== undefined ? activeBase.lazyLassoRadius : 50;
      if (lazyLassoValueDisplay) {
        lazyLassoValueDisplay.textContent = lazyLassoSlider.value;
      }
    }
    const cutShapeSelect = document.getElementById("cutShapeSelect");
    if (cutShapeSelect) {
      cutShapeSelect.value = activeBase.cutShape || "trace";
    }
  }

  const standardSizesControls = document.getElementById(
    "standard-sizes-controls",
  );
  if (standardSizesControls)
    standardSizesControls.style.display =
      activeTabId === "base" ? "flex" : "none";

  const textControls = document.getElementById("text-editing-controls");
  const customLayers = activeBase.customLayers || [];
  const layer = customLayers.find((l) => l.id === activeTabId);
  const isTextLayer = layer && layer.type === "text";

  // Text layer controls
  if (textControls) {
    textControls.style.display = isTextLayer ? "block" : "none";
    textControls.hidden = !isTextLayer;
  }

  // Custom Layers (but not Text layer)
  if (customControls) {
    if (activeTabId !== "base" && activeTabId !== "cutline" && !isTextLayer && layer) {
      customControls.style.display = "flex";
      // Update dropzone text if we have it
      const label = document.querySelector('label[for="imageUpload"]');
      if (label) {
        label.textContent = `Upload image for ${layer ? layer.name : "Custom"} Layer:`;
      }
      // Update custom layer type select
      const typeContainer = document.getElementById("printInkTypeContainer");
      const typeSelect = document.getElementById("printInkTypeSelect");
      if (
        typeContainer &&
        typeSelect &&
        layer &&
        typeof pricingConfig !== "undefined" &&
        pricingConfig &&
        pricingConfig.layers
      ) {
        const pricingLayer = pricingConfig.layers.find(
          (l) =>
            l.name.toLowerCase() === layer.type.toLowerCase() ||
            l.id === layer.type,
        );
        if (
          pricingLayer &&
          pricingLayer.subTypes &&
          pricingLayer.subTypes.length > 0
        ) {
          typeContainer.style.display = "flex";
          // Re-populate options if they changed (or if first time)
          typeSelect.innerHTML = "";
          pricingLayer.subTypes.forEach((sub) => {
            const option = document.createElement("option");
            option.value = sub.id;
            option.textContent = sub.name;
            typeSelect.appendChild(option);
          });

          if (!layer.subType) {
            layer.subType = pricingLayer.subTypes[0].id;
          }
          typeSelect.value = layer.subType;
        } else {
          typeContainer.style.display = "none";
        }
      }

      if (alphaColorPicker)
        alphaColorPicker.value = (layer && layer.alphaColorHex) || "#ffffff";
      if (maskColorPicker)
        maskColorPicker.value = (layer && layer.maskColorHex) || "#000000";
    } else {
      customControls.style.display = "none";
      const label = document.querySelector('label[for="imageUpload"]');
      if (label) label.textContent = "Upload Sticker Design Image:";
    }
  }
}

function addCustomLayer(type) {
  const newLayer = {
    id: `custom_${Date.now()}`,
    name: type,
    type: type.toLowerCase(),
    image: null,
    visible: true,
  };
  activeBase.customLayers.push(newLayer);
  selectedLegendTab = newLayer.id;
  renderLayerTabs();
  calculateAndUpdatePrice();
}

function deleteCustomLayer(id) {
  activeBase.customLayers = activeBase.customLayers.filter((l) => l.id !== id);
  if (selectedLegendTab === id) selectedLegendTab = "base";
  renderLayerTabs();
  calculateAndUpdatePrice();
}

function redrawAllForHighlight() {
  try {
    // We can just reuse redrawAll because it respects the activeBase.layerOrder.
    redrawAll();
  } catch (error) {
    console.error("[CLIENT] ERROR in redrawAllForHighlight:", error);
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
  if (!canvas || !ctx || !activeBase.originalImage) {
    showNotification("Please load an image before adding text.", "error");
    return;
  }
  const activeTabId = getActiveLineId();
  const layer = activeBase.customLayers.find((l) => l.id === activeTabId);
  if (!layer || layer.type !== "text") {
    showNotification("Please select a Text layer first.", "error");
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

  // Draw text onto an offscreen canvas to use as the layer image
  const textCanvas = document.createElement("canvas");
  textCanvas.width = canvas.width;
  textCanvas.height = canvas.height;
  const textCtx = textCanvas.getContext("2d");

  textCtx.font = `${size}px ${font}`;
  textCtx.fillStyle = color;
  textCtx.textAlign = "center";
  textCtx.textBaseline = "middle";
  textCtx.fillText(text, textCanvas.width / 2, textCanvas.height / 2);

  // Set the text canvas as the image for the current text layer
  const image = new Image();
  image.onload = () => {
    layer.image = image;
    redrawAll();
    showNotification(`Text "${text}" added to layer.`, "success");
  };
  image.src = textCanvas.toDataURL();
}

function handleClearImage() {
  if (!confirm("Are you sure you want to remove the image?")) return;

  activeBase.originalImage = null;
  activeBase.basePolygons = [];
  activeBase.currentPolygons = [];
  activeBase.rasterCutlinePoly = null;
  activeBase.currentCutline = [];
  currentBounds = null;
  activeBase.cleanCanvasState = null;
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
  renderLayerTabs();

  if (clearFileBtn) clearFileBtn.classList.add("hidden");
  if (fileInputGlobalRef) fileInputGlobalRef.focus();
  showNotification("Image removed.", "info");
}

function setTemplate(templateId) {
  currentTemplate = templateId;

  if (templateBlankBtn)
    templateBlankBtn.classList.remove(
      "bg-indigo-100",
      "text-indigo-700",
      "border-indigo-200",
    );
  if (templateBlankBtn)
    templateBlankBtn.classList.add(
      "bg-white",
      "text-gray-700",
      "border-gray-300",
    );
  if (templateHelloBtn)
    templateHelloBtn.classList.remove(
      "bg-indigo-100",
      "text-indigo-700",
      "border-indigo-200",
    );
  if (templateHelloBtn)
    templateHelloBtn.classList.add(
      "bg-white",
      "text-gray-700",
      "border-gray-300",
    );
  if (templateThankYouBtn)
    templateThankYouBtn.classList.remove(
      "bg-indigo-100",
      "text-indigo-700",
      "border-indigo-200",
    );
  if (templateThankYouBtn)
    templateThankYouBtn.classList.add(
      "bg-white",
      "text-gray-700",
      "border-gray-300",
    );

  let activeBtn;
  if (templateId === "blank") activeBtn = templateBlankBtn;
  if (templateId === "hello_badge") activeBtn = templateHelloBtn;
  if (templateId === "thank_you") activeBtn = templateThankYouBtn;

  if (activeBtn) {
    activeBtn.classList.remove("bg-white", "text-gray-700", "border-gray-300");
    activeBtn.classList.add(
      "bg-indigo-100",
      "text-indigo-700",
      "border-indigo-200",
    );
  }

  // Guardrails
  const isTemplate = templateId !== "blank";
  if (rotateLeftBtnEl) rotateLeftBtnEl.disabled = isTemplate;
  if (rotateRightBtnEl) rotateRightBtnEl.disabled = isTemplate;
  const uploadSection = document.getElementById("uploadFileSection");
  if (uploadSection) {
    uploadSection.style.display = isTemplate ? "none" : "block";
  }

  if (isTemplate) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      activeBase.originalImage = img;
      setCanvasSize(img.width, img.height);
      ctx.clearRect(0, 0, img.width, img.height);
      ctx.drawImage(activeBase.originalImage, 0, 0, img.width, img.height);

      const dpr = window.devicePixelRatio || 1;

      const currentImageData = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      currentBounds = {
        minX: 0,
        minY: 0,
        maxX: canvas.width - 1,
        maxY: canvas.height - 1,
        width: canvas.width,
        height: canvas.height,
      };

      redrawAll();
      updateEditingButtonsState(false);

      // Auto-populate text based on template
      if (templateId === "hello_badge" && textInput) {
        textInput.value = "John Doe";
        textColorInput.value = "#000000";
        if (textSizeInput) textSizeInput.value = "30";
        if (textSizeSlider) textSizeSlider.value = "30";
        handleAddText(); // Will trigger clearCanvasAndDraw again with the text
      } else if (templateId === "thank_you" && textInput) {
        textInput.value = "Your name here";
        textColorInput.value = "#d97706";
        if (textSizeInput) textSizeInput.value = "20";
        if (textSizeSlider) textSizeSlider.value = "20";
        handleAddText();
      } else {
        calculateAndUpdatePrice();
      }
    };
    img.onerror = () => showNotification("Failed to load template", "error");
    img.src = `/templates/${templateId}.svg`;
  } else {
    // Reset to blank canvas
    if (
      confirm(
        "Are you sure you want to reset to a blank canvas? This will clear your current design.",
      )
    ) {
      activeBase.originalImage = null;
      activeBase.basePolygons = [];
      activeBase.currentPolygons = [];
      activeBase.rasterCutlinePoly = null;
      activeBase.currentCutline = [];
      currentBounds = null;
      activeBase.cleanCanvasState = null;
      cachedTempCanvas = null;
      if (fileInputGlobalRef) fileInputGlobalRef.value = "";
      if (canvas && ctx) {
        setCanvasSize(500, 400);
        ctx.clearRect(0, 0, 500, 400);
      }
      updateEditingButtonsState(true);
      calculateAndUpdatePrice();
      renderLayerTabs();
      if (clearFileBtn) clearFileBtn.classList.add("hidden");
    } else {
      // Revert button if they cancel
      setTemplate("blank"); // actually wait, infinite loop... let's just clear manually if needed.
    }
  }
}

function handleResetImage() {
  if (!activeBase.originalImage && activeBase.basePolygons.length === 0) {
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

  if (activeBase.originalImage) {
    // Raster Image Reset
    isGrayscale = false;
    isSepia = false;
    activeBase.basePolygons = [];
    activeBase.currentPolygons = [];
    activeBase.currentCutline = [];
    activeBase.rasterCutlinePoly = null; // Bolt Fix: Clear raster cutline on reset
    let newWidth = activeBase.originalImage.width,
      newHeight = activeBase.originalImage.height;

    if (canvas && ctx) {
      setCanvasSize(newWidth, newHeight);
      ctx.clearRect(0, 0, newWidth, newHeight);
      ctx.drawImage(activeBase.originalImage, 0, 0, newWidth, newHeight);

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
        if (cutShapeSelect) cutShapeSelect.value = "trace";
        handleGenerateCutline(true);
      } else {
        if (cutShapeSelect) cutShapeSelect.value = "square";
        handleGenerateCutline(true);
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
  } else if (activeBase.basePolygons.length > 0) {
    // SVG Reset
    activeBase.currentPolygons = activeBase.basePolygons;
    redrawAll();
    showNotification("Image reset to original.", "success");
  }
}

function rotateCanvasContentFixedBounds(angleDegrees) {
  if (activeBase.basePolygons.length > 0) {
    // SVG Vector Rotation
    const bounds = getPolygonsBounds(activeBase.currentPolygons);
    const centerX = bounds.left + (bounds.right - bounds.left) / 2;
    const centerY = bounds.top + (bounds.bottom - bounds.top) / 2;
    const angleRad = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    // Bolt Optimization: Replace nested .map() with pre-allocated arrays and standard for-loops.
    // This eliminates closure allocation overhead and reduces GC pressure in hot requestAnimationFrame paths.
    const newPolygons = new Array(activeBase.currentPolygons.length);
    for (let i = 0; i < activeBase.currentPolygons.length; i++) {
      const poly = activeBase.currentPolygons[i];
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
    activeBase.currentPolygons = newPolygons;
    redrawAll();
  } else if (activeBase.originalImage) {
    // Use the current canvas dimensions, which represent the scaled image size
    const dpr = window.devicePixelRatio || 1;
    let w = canvas.width;
    let h = canvas.height;
    let sourceCanvas = canvas;

    if (activeBase.cleanCanvasState) {
      if (
        !cachedTempCanvas ||
        cachedTempCanvas.width !== activeBase.cleanCanvasState.width ||
        cachedTempCanvas.height !== activeBase.cleanCanvasState.height
      ) {
        cachedTempCanvas = document.createElement("canvas");
        cachedTempCanvas.width = activeBase.cleanCanvasState.width;
        cachedTempCanvas.height = activeBase.cleanCanvasState.height;
        cachedTempCanvas
          .getContext("2d")
          .putImageData(activeBase.cleanCanvasState, 0, 0);
      }
      sourceCanvas = cachedTempCanvas;
      w = activeBase.cleanCanvasState.width;
      h = activeBase.cleanCanvasState.height;
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
    if (activeBase.rasterCutlinePoly) {
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
      const newRasterCutlinePoly = new Array(
        activeBase.rasterCutlinePoly.length,
      );
      for (let i = 0; i < activeBase.rasterCutlinePoly.length; i++) {
        const poly = activeBase.rasterCutlinePoly[i];
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
      activeBase.rasterCutlinePoly = newRasterCutlinePoly;

      // Regenerate activeBase.currentCutline from rotated poly
      const lazyLassoSlider = document.getElementById("lazyLassoSlider");
      const currentLassoRadius =
        lazyLassoSlider && lazyLassoSlider.value
          ? parseInt(lazyLassoSlider.value, 10)
          : 50;
      const cutline = generateCutLine(
        activeBase.rasterCutlinePoly,
        activeBase.cutlineOffset !== undefined ? activeBase.cutlineOffset : 15,
        currentLassoRadius,
      );
      activeBase.currentCutline = cutline;
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
      activeBase.currentCutline = [
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
  if (!activeBase.originalImage || !ctx || !canvas) return;

  // Bolt Optimization: Use hardware-accelerated Canvas filters via helper
  // We draw without offset here so the clean state is saved at the origin
  drawImageWithFilters(
    ctx,
    activeBase.originalImage,
    canvas.width,
    canvas.height,
    {
      grayscale: isGrayscale,
      sepia: isSepia,
    },
  );

  saveCleanState(); // Save state before decorations

  // Explicitly restore stroke style before drawing decorations
  ctx.strokeStyle = "rgba(128, 128, 128, 0.9)";
  ctx.lineWidth = 2;

  // Also redraw the bounding box and size indicator, which are cleared by the operation.
  if (currentBounds) {
    // We must pass the current offset down to the drawing functions,
    // but the decorations function handles the offset for the image,
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
  if (!canvas || !ctx || !activeBase.originalImage) return;

  const wasOn = isGrayscale;
  isGrayscale = !wasOn; // Toggle state
  isSepia = false; // Ensure sepia is off

  updateFilterButtonVisuals();
  redrawOriginalImageWithFilters();
}

function toggleSepiaFilter() {
  if (!canvas || !ctx || !activeBase.originalImage) return;

  const wasOn = isSepia;
  isSepia = !wasOn; // Toggle state
  isGrayscale = false; // Ensure grayscale is off

  updateFilterButtonVisuals();
  redrawOriginalImageWithFilters();
}

function handleStandardResize(targetInches) {
  if (
    !pricingConfig ||
    (!activeBase.originalImage && activeBase.basePolygons.length === 0)
  ) {
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
  if (activeBase.basePolygons.length > 0) {
    const bounds = getPolygonsBounds(activeBase.basePolygons);
    currentMaxWidthPixels = Math.max(bounds.width, bounds.height);
  } else {
    currentMaxWidthPixels = Math.max(
      activeBase.originalImage.width,
      activeBase.originalImage.height,
    );
  }

  if (currentMaxWidthPixels <= 0) return;

  const scale = targetPixels / currentMaxWidthPixels;

  // NOTE: If scale is 1, maybe it already scaled but currentMaxWidthPixels
  // was taken from the raw image. If this gets called multiple times, we're
  // ALWAYS multiplying activeBase.originalImage.width by `scale` in the raster logic below:
  // const newWidth = activeBase.originalImage.width * scale;
  // This is actually CORRECT because currentMaxWidthPixels is also derived from
  // activeBase.originalImage.width. So `scale = targetPixels / activeBase.originalImage.width`.
  // Therefore `newWidth = activeBase.originalImage.width * (targetPixels / activeBase.originalImage.width)`
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

  if (activeBase.basePolygons.length > 0) {
    // SVG Vector Resizing - always scale from the original
    // Bolt Optimization: Replace nested .map() with pre-allocated arrays to avoid dynamic array resizing overhead.
    const newPolygons = new Array(activeBase.basePolygons.length);
    for (let i = 0; i < activeBase.basePolygons.length; i++) {
      const poly = activeBase.basePolygons[i];
      const newPoly = new Array(poly.length);
      for (let j = 0; j < poly.length; j++) {
        const point = poly[j];
        newPoly[j] = { x: point.x * scale, y: point.y * scale };
      }
      newPolygons[i] = newPoly;
    }
    activeBase.currentPolygons = newPolygons;
    redrawAll();
  } else if (activeBase.originalImage) {
    const oldWidth = activeBase.width || activeBase.originalImage.width;
    const oldHeight = activeBase.height || activeBase.originalImage.height;

    // Raster Image Resizing - always use the original image to prevent quality loss
    const newWidth = activeBase.originalImage.width * scale;
    const newHeight = activeBase.originalImage.height * scale;

    if (newWidth > 0 && newHeight > 0) {
      const scaleX = oldWidth > 0 ? (newWidth / oldWidth) : 1;
      const scaleY = oldHeight > 0 ? (newHeight / oldHeight) : 1;

      activeBase.width = newWidth;
      activeBase.height = newHeight;

      // Handle Raster Cutline Scaling
      if (activeBase.rasterCutlinePoly && activeBase.rasterCutlinePoly.length > 0) {
        activeBase.rasterCutlinePoly = activeBase.rasterCutlinePoly.map((poly) =>
          poly.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }))
        );
      }

      if (activeBase.currentCutline && activeBase.currentCutline.length > 0) {
        activeBase.currentCutline = activeBase.currentCutline.map((poly) =>
          poly.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }))
        );
      } else {
        activeBase.currentCutline = [
          [
            { x: 0, y: 0 },
            { x: newWidth, y: 0 },
            { x: newWidth, y: newHeight },
            { x: 0, y: newHeight },
          ],
        ];
      }

      // Trigger the price update and redraw all layers
      calculateAndUpdatePrice();
      redrawAll();
    }
  }
}

// --- Smart Cutline Generation ---

function handleGenerateFromBase() {
  if (!activeBase.originalImage) {
    showNotification("Please upload a base image first.", "error");
    return;
  }
  const activeTabId = getActiveLineId();
  if (!activeTabId || activeTabId === "base" || activeTabId === "cutline") {
    showNotification(
      "Please select a custom layer to generate the mask into.",
      "error",
    );
    return;
  }

  const customLayer = activeBase.customLayers.find((l) => l.id === activeTabId);
  if (!customLayer) return;

  showNotification("Generating mask from base design...", "info");

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = activeBase.originalImage.width;
  tempCanvas.height = activeBase.originalImage.height;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.filter = "grayscale(100%)";
  tempCtx.drawImage(activeBase.originalImage, 0, 0);

  const processedImg = new Image();
  processedImg.onload = () => {
    customLayer.image = processedImg;
    showNotification(
      `Generated mask for ${customLayer.name} layer.`,
      "success",
    );
    redrawAllForHighlight();
  };
  processedImg.src = tempCanvas.toDataURL();
}

function handleDownloadCutline() {
  if (!activeBase.currentCutline || activeBase.currentCutline.length === 0) {
    showNotification("No cutline generated to download.", "error");
    return;
  }
  try {
    const svgContent = generateSvgFromCutline(activeBase.currentCutline, currentBounds);
    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "splotch-cutline.svg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showNotification("Cutline downloaded successfully.", "success");
  } catch (error) {
    console.error("Error downloading cutline:", error);
    showNotification("Failed to download cutline.", "error");
  }
}

function handleGenerateCutline(skipPrompt = false) {
  if (stickers.length === 0 || activeStickerIndex === -1) {
    if (!skipPrompt) {
      showNotification("Please upload an image first.", "error");
    }
    return;
  }

  const activeBaseLayer = stickers[activeStickerIndex];
  if (!activeBaseLayer.image && !activeBaseLayer.basePolygons?.length) return;
  if (skipPrompt instanceof Event) skipPrompt = false;
  if (!canvas || !ctx || (!activeBaseLayer.image && !activeBaseLayer.basePolygons?.length)) {
    showNotification(
      "Smart cutline requires a raster image (PNG, JPG). Please upload one.",
      "error",
    );
    return;
  }

  // Pass the raw activeBase.cleanCanvasState if available so we don't trace the bounding box and rulers.
  // We use a temporary canvas to get the ImageData if it's stored as ImageData.
  let currentImageData;
  if (activeBase.cleanCanvasState) {
    currentImageData = activeBase.cleanCanvasState;
  } else {
    currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  if (!skipPrompt) {
    showNotification("Generating smart cutline...", "info");
  }
  showCanvasLoading(
    "Calculating Cutline...",
    "Tracing contours and smoothing borders",
  );

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

  const cutShapeSelect = document.getElementById("cutShapeSelect");
  const selectedShape = cutShapeSelect ? cutShapeSelect.value : "trace";
  activeBase.cutShape = selectedShape;

  try {
    const activeSticker = getActiveSticker() || activeBase;
    const img = activeSticker.originalImage || activeSticker.image;
    const sourceWidth = img ? (img.naturalWidth || img.width) : (activeSticker.width || canvas.width);
    const sourceHeight = img ? (img.naturalHeight || img.height) : (activeSticker.height || canvas.height);
    const targetWidth = activeSticker.width || sourceWidth;
    const targetHeight = activeSticker.height || sourceHeight;
    const logicalCanvasWidth = targetWidth;
    const logicalCanvasHeight = targetHeight;

    // --- Performance Optimization: Downscale before tracing ---
    const maxDim = 500;
    const scaleFactor = Math.min(
      1,
      maxDim / Math.max(sourceWidth, sourceHeight),
    );
    const scaledWidth = Math.max(
      1,
      Math.round(sourceWidth * scaleFactor),
    );
    const scaledHeight = Math.max(
      1,
      Math.round(sourceHeight * scaleFactor),
    );

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = scaledWidth;
    tempCanvas.height = scaledHeight;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
    if (img) {
      tempCtx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
    } else if (activeBase.cleanCanvasState) {
      tempCtx.putImageData(activeBase.cleanCanvasState, 0, 0);
    } else {
      tempCtx.drawImage(canvas, 0, 0, scaledWidth, scaledHeight);
    }
    const scaledImageData = tempCtx.getImageData(0, 0, scaledWidth, scaledHeight);

    let traceTimeout = setTimeout(() => {
      console.warn("traceWorker timed out, using fallback cutline");
      const fallbackPoly = [
        [
          { x: 0, y: 0 },
          { x: logicalCanvasWidth, y: 0 },
          { x: logicalCanvasWidth, y: logicalCanvasHeight },
          { x: 0, y: logicalCanvasHeight },
        ],
      ];
      activeBase.rasterCutlinePoly = fallbackPoly;
      activeBase.currentCutline = fallbackPoly;
      currentBounds = getPolygonsBounds(fallbackPoly);
      redrawAll();
      calculateAndUpdatePrice();
      updateEditingButtonsState(false);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
      hideCanvasLoading();
    }, 4000);

    traceWorker.onmessage = function (e) {
      clearTimeout(traceTimeout);
      console.log("Trace worker message received:", e.data.success);
      try {
        if (!e.data.success) {
          console.error("Trace error: ", e.data.error);
        }
        if (e.data.success) {
          let contours = e.data.contours;

          // Filter contours to remove noise (e.g. area < 400 pixels)
          const imageArea = sourceWidth * sourceHeight;
          const minIslandArea = Math.max(100, imageArea * 0.0002);
          let significantContours = (contours || [])
            .filter((c) => getPolygonArea(c) > minIslandArea)
            .map((c) => simplifyPolygon(c, 1.5));

          // Suppress "island cuts" (internal holes) that are larger than 2mm.
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
            let maxAllowedHoleSize = (2 / 25.4) * ppi;
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
            if (selectedShape === "circle" || selectedShape === "square") {
              significantContours = [
                [
                  { x: 0, y: 0 },
                  { x: sourceWidth, y: 0 },
                  { x: sourceWidth, y: sourceHeight },
                  { x: 0, y: sourceHeight },
                ],
              ];
            } else {
              ctx.putImageData(originalCanvasData, 0, 0);
              showNotification(
                "Could not detect a usable outline. Try an image with a transparent background.",
                "error",
              );
              if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
              }
              hideCanvasLoading();
              return;
            }
          }

          if (selectedShape === "circle" || selectedShape === "square") {
            let minX = Infinity,
              maxX = -Infinity,
              minY = Infinity,
              maxY = -Infinity;
            significantContours.forEach((c) => {
              c.forEach((p) => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
              });
            });

            if (minX === Infinity) {
              minX = 0;
              maxX = sourceWidth;
              minY = 0;
              maxY = sourceHeight;
            }

            const hw = (maxX - minX) / 2;
            const hh = (maxY - minY) / 2;
            const cx = minX + hw;
            const cy = minY + hh;
            let poly = [];

            if (selectedShape === "circle") {
              const r = Math.max(hw, hh);
              const steps = 64;
              for (let i = 0; i < steps; i++) {
                const theta = (i / steps) * 2 * Math.PI;
                poly.push({
                  x: cx + r * Math.cos(theta),
                  y: cy + r * Math.sin(theta),
                });
              }
            } else {
              poly = [
                { x: minX, y: minY },
                { x: maxX, y: minY },
                { x: maxX, y: maxY },
                { x: minX, y: maxY },
              ];
            }
            significantContours = [poly];
          }

          const scale = 100;
          const finalContours = [];

          significantContours.forEach((contour) => {
            const smoothedContour =
              selectedShape === "square" ? contour : smoothPolygon(contour, 3);

            const scaledPoly = new Array(smoothedContour.length);
            for (let j = 0; j < smoothedContour.length; j++) {
              const p = smoothedContour[j];
              scaledPoly[j] = {
                X: Math.round(p.x * scale),
                Y: Math.round(p.y * scale),
              };
            }
            const cleanedScaledPoly = ClipperLib.Clipper.CleanPolygon(
              scaledPoly,
              0.1,
            );

            if (cleanedScaledPoly && cleanedScaledPoly.length >= 3) {
              const newPoly = new Array(cleanedScaledPoly.length);
              for (let j = 0; j < cleanedScaledPoly.length; j++) {
                const p = cleanedScaledPoly[j];
                newPoly[j] = { x: p.X / scale, y: p.Y / scale };
              }
              finalContours.push(newPoly);
            }
          });

          if (finalContours.length === 0) {
            ctx.putImageData(originalCanvasData, 0, 0);
            showNotification(
              "Could not detect a usable outline. Try an image with a transparent background.",
              "error",
            );
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = originalText;
            }
            hideCanvasLoading();
            return;
          }

          const renderScaleX = targetWidth / sourceWidth;
          const renderScaleY = targetHeight / sourceHeight;
          const rasterCutlineOutput = new Array(finalContours.length);
          for (let i = 0; i < finalContours.length; i++) {
            const poly = finalContours[i];
            const newPoly = new Array(poly.length);
            for (let j = 0; j < poly.length; j++) {
              const p = poly[j];
              newPoly[j] = { x: p.x * renderScaleX, y: p.y * renderScaleY };
            }
            rasterCutlineOutput[i] = newPoly;
          }

          rasterCutlineOutput.sort(
            (a, b) => getPolygonArea(b) - getPolygonArea(a),
          );
          activeBase.rasterCutlinePoly = rasterCutlineOutput.slice(0, 50);

          let curRadius =
            lazyLassoSlider && lazyLassoSlider.value
              ? parseInt(lazyLassoSlider.value, 10)
              : 50;
          let currentOffset = activeBase.cutlineOffset !== undefined ? activeBase.cutlineOffset : 15;
          if (cutlineOffsetSlider && cutlineOffsetSlider.value) {
            const step = parseInt(cutlineOffsetSlider.value, 10);
            if (step === 0) currentOffset = 0;
            else if (step === 1) currentOffset = 15;
            else if (step === 2) currentOffset = 35;
          }

          console.log("Sending to generateCutLineAsync");
          generateCutLineAsync(
            activeBase.rasterCutlinePoly,
            currentOffset,
            curRadius,
          )
            .then((cutline) => {
              activeBase.currentCutline = cutline;
              currentBounds = getPolygonsBounds(cutline);
              redrawAll();
              calculateAndUpdatePrice();
              updateEditingButtonsState(false);
              const generateCutlineBtn =
                document.getElementById("generateCutlineBtn");
              if (generateCutlineBtn) {
                generateCutlineBtn.disabled = false;
                generateCutlineBtn.classList.remove(
                  "opacity-50",
                  "cursor-not-allowed",
                );
                generateCutlineBtn.innerHTML = "Generate Smart Cutline";
              }
              if (!skipPrompt) {
                showNotification(
                  "Smart cutline generated successfully.",
                  "success",
                );
              }
              hideCanvasLoading();
            })
            .catch((err) => {
              console.error("generateCutLineAsync failed:", err);
              showNotification(`Error: ${err.message}`, "error");
              updateEditingButtonsState(false);
              const generateCutlineBtn =
                document.getElementById("generateCutlineBtn");
              if (generateCutlineBtn) {
                generateCutlineBtn.disabled = false;
                generateCutlineBtn.classList.remove(
                  "opacity-50",
                  "cursor-not-allowed",
                );
                generateCutlineBtn.innerHTML = "Generate Smart Cutline";
              }
              hideCanvasLoading();
            });
        } else {
          ctx.putImageData(originalCanvasData, 0, 0);
          showNotification(`Error: ${e.data.error}`, "error");
          console.error(e.data.error);

          updateEditingButtonsState(false);
          const generateCutlineBtn =
            document.getElementById("generateCutlineBtn");
          if (generateCutlineBtn) {
            generateCutlineBtn.disabled = false;
            generateCutlineBtn.classList.remove(
              "opacity-50",
              "cursor-not-allowed",
            );
            generateCutlineBtn.innerHTML = "Generate Smart Cutline";
          }
          hideCanvasLoading();
        }
      } catch (innerErr) {
        console.error("Error processing trace result:", innerErr);
        hideCanvasLoading();
      }
    };

    traceWorker.postMessage({
      imageData: scaledImageData,
      cutlineSensitivity: cutlineSensitivity,
      scaleFactor: scaleFactor,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });
  } catch (error) {
    // Restore the original canvas if the process failed
    ctx.putImageData(originalCanvasData, 0, 0);
    showNotification(`Error: ${error.message}`, "error");
    console.error(error);

    updateEditingButtonsState(false);
    const generateCutlineBtn = document.getElementById("generateCutlineBtn");
    if (generateCutlineBtn) {
      generateCutlineBtn.disabled = false;
      generateCutlineBtn.classList.remove("opacity-50", "cursor-not-allowed");
      generateCutlineBtn.innerHTML = "Generate Smart Cutline";
    }
    hideCanvasLoading();
  }
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
  showCanvasLoading("Loading Design...", "Fetching saved design from server");
  showNotification("Loading your previous design...", "info");
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.onload = () => {
    activeBase.originalImage = img;
    updateEditingButtonsState(false); // Enable editing

    // Standard canvas init logic
    let newWidth = img.width,
      newHeight = img.height;
    setCanvasSize(newWidth, newHeight);
    ctx.clearRect(0, 0, newWidth, newHeight);
    ctx.drawImage(activeBase.originalImage, 0, 0, newWidth, newHeight);

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
      if (cutShapeSelect) cutShapeSelect.value = "trace";
      handleGenerateCutline(true);
    } else {
      if (cutShapeSelect) cutShapeSelect.value = "square";
      activeBase.rasterCutlinePoly = [
        [
          { x: 0, y: 0 },
          { x: logicalWidth, y: 0 },
          { x: logicalWidth, y: logicalHeight },
          { x: 0, y: logicalHeight },
        ],
      ];

      cutlineOffset = 15;
      if (cutlineOffsetSlider) {
        cutlineOffsetSlider.value = 1;
      }
      if (cutlineOffsetValueDisplay) {
        cutlineOffsetValueDisplay.textContent = "1.5mm";
      }

      const cutline = generateCutLine(
        activeBase.rasterCutlinePoly,
        activeBase.cutlineOffset !== undefined ? activeBase.cutlineOffset : 15,
      );
      activeBase.currentCutline = cutline;
      currentBounds = getPolygonsBounds(cutline);
    }

    calculateAndUpdatePrice();
    drawCanvasDecorations(currentBounds);
    if (clearFileBtn) clearFileBtn.classList.remove("hidden");

    // Show Legend
    renderLayerTabs();
    hideCanvasLoading();

    showNotification("Design loaded! You can now adjust options.", "success");
  };
  img.onerror = () => {
    hideCanvasLoading();
    showNotification("Failed to load design image.", "error");
  };
  img.src = decodeURIComponent(imageUrl);
}

async function loadProductForBuyer(productId) {
  try {
    currentProductId = productId;
    showCanvasLoading("Loading Product...", "Retrieving product design and pricing");
    showNotification("Loading product design...", "info");

    const response = await fetch(`${serverUrl}/api/products/${productId}`);
    if (!response.ok) throw new Error("Product not found");

    const product = await response.json();

    // Set Pricing Markup
    creatorProfitCents = product.creatorProfitCents;

    // Load Image
    const img = new Image();
    img.onload = () => {
      activeBase.originalImage = img;
      // Draw
      let newWidth = img.width,
        newHeight = img.height;
      setCanvasSize(newWidth, newHeight);
      ctx.clearRect(0, 0, newWidth, newHeight);
      ctx.drawImage(activeBase.originalImage, 0, 0, newWidth, newHeight);

      saveCleanState(); // Save state before decorations

      // Mock Cutline if not provided (or parse it if it is)
      // For MVP, if there is no cutline path in response, we default to box?
      // Actually, products should have cutlines if they were created via the UI.
      // But we don't have code to load the cutline from a file URL back into `activeBase.currentCutline` polygons easily
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
        if (cutShapeSelect) cutShapeSelect.value = "trace";
        handleGenerateCutline(true);
      } else {
        if (cutShapeSelect) cutShapeSelect.value = "square";
        handleGenerateCutline(true);
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
      renderLayerTabs();
      hideCanvasLoading();

      showNotification("Design loaded!", "success");
    };
    img.onerror = () => {
      hideCanvasLoading();
      showNotification("Failed to load product design image.", "error");
    };
    img.crossOrigin = "Anonymous"; // Important for canvas manipulation if on different port
    img.src = product.designImagePath;
  } catch (error) {
    console.error(error);
    hideCanvasLoading();
    showNotification("Failed to load product.", "error");
  }
}

// --- Sticker Pack Layer
let listSortableInstance = null;

function renderLayerList() {
    const listEl = document.getElementById("sticker-list");
    if (!listEl) return;
    
    // Toggle boundary panel visibility
    const boundaryPanel = document.getElementById("boundary-settings-panel");
    if (boundaryPanel) {
        boundaryPanel.style.display = (activeStickerIndex === 'boundary') ? "block" : "none";
    }

    listEl.innerHTML = "";
    
    const reversedLayers = [...stickers].reverse();
    
    reversedLayers.forEach((layer, i) => {
        const originalIndex = stickers.length - 1 - i;
        const isSvgLayer = !layer.image && !layer.originalImage;
        
        const li = document.createElement("li");
        
        // Base styling with drag handle cursor
        let liClasses = "flex items-center justify-between p-2 border rounded transition-colors ";
        
        if (activeStickerIndex === originalIndex) {
            liClasses += isSvgLayer ? "bg-cyan-100 border-cyan-400 shadow-sm" : "bg-indigo-100 border-indigo-400 shadow-sm";
        } else {
            liClasses += isSvgLayer ? "bg-cyan-50 border-cyan-200 hover:bg-cyan-100" : "bg-white border-gray-200 hover:bg-gray-50";
        }
        
        li.className = liClasses;
        li.dataset.index = originalIndex; // Store original index for sorting
        
        // Click to select
        li.addEventListener("click", () => {
            setActiveSticker(originalIndex);
            renderLayerList();
            renderLayerTabs();
            redrawAll();
            updateEditingControlsForActiveLayer();
            updateFilterButtonVisuals();
        });
        
        const leftSide = document.createElement("div");
        leftSide.className = "flex items-center gap-2";
        
        // Drag Handle Icon
        const dragHandle = document.createElement("div");
        dragHandle.className = "drag-handle p-1 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600";
        dragHandle.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>`;
        leftSide.appendChild(dragHandle);

        // Thumbnail
        if (!isSvgLayer) {
            const thumb = document.createElement("img");
            thumb.src = (layer.image || layer.originalImage).src;
            thumb.className = "w-8 h-8 object-contain bg-gray-100 rounded pointer-events-none";
            leftSide.appendChild(thumb);
        } else {
            const thumb = document.createElement("div");
            thumb.className = "w-8 h-8 bg-cyan-100 border border-cyan-300 rounded flex items-center justify-center text-[10px] font-bold text-cyan-700 pointer-events-none";
            thumb.textContent = "SVG";
            leftSide.appendChild(thumb);
        }
        
        const nameSpan = document.createElement("span");
        nameSpan.className = `text-sm font-medium truncate w-32 ${isSvgLayer ? 'text-cyan-800' : 'text-gray-700'} pointer-events-none`;
        nameSpan.textContent = isSvgLayer ? "Cutline (SVG)" : layer.name;
        leftSide.appendChild(nameSpan);
        
        li.appendChild(leftSide);
        
        const deleteBtn = document.createElement("button");
        deleteBtn.innerHTML = "&times;";
        deleteBtn.className = "text-gray-400 hover:text-red-500 font-bold px-2 py-1 z-10 relative";
        deleteBtn.title = "Delete Sticker";
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            removeSticker(originalIndex);
            renderLayerList();
            redrawAll();
        });
        
        li.appendChild(deleteBtn);
        listEl.appendChild(li);
    });
    
    // Always append the Sheet Boundary layer at the bottom
    if (stickers.length > 0) {
        const boundaryLi = document.createElement("li");
        boundaryLi.className = "ignore-drag"; // Crucial for Sortable filter
        
        let bClasses = "flex items-center justify-between p-2 border rounded cursor-pointer transition-colors ";
        if (activeStickerIndex === 'boundary') {
            bClasses += "bg-red-50 border-red-400 shadow-sm";
        } else {
            bClasses += "bg-white border-gray-200 hover:bg-red-50";
        }
        
        const innerDiv = document.createElement("div");
        innerDiv.className = bClasses + " w-full";
        
        // Click to select
        innerDiv.addEventListener("click", () => {
            setActiveSticker('boundary');
            renderLayerList();
            renderLayerTabs();
            redrawAll();
            updateEditingControlsForActiveLayer();
            updateFilterButtonVisuals();
        });
        
        const leftSide = document.createElement("div");
        leftSide.className = "flex items-center gap-2 pl-6"; // pl-6 to offset missing drag handle
        
        const thumb = document.createElement("div");
        thumb.className = "w-8 h-8 bg-red-100 border border-red-300 rounded flex items-center justify-center text-[10px] font-bold text-red-700 pointer-events-none";
        thumb.textContent = "BND";
        leftSide.appendChild(thumb);
        
        const nameSpan = document.createElement("span");
        nameSpan.className = "text-sm font-medium truncate w-32 text-red-800 pointer-events-none";
        nameSpan.textContent = "Sheet Boundary";
        leftSide.appendChild(nameSpan);
        
        innerDiv.appendChild(leftSide);
        boundaryLi.appendChild(innerDiv);
        listEl.appendChild(boundaryLi);
    }
    
    if (listSortableInstance) {
        listSortableInstance.destroy();
    }
    
    listSortableInstance = new Sortable(listEl, {
        animation: 150,
        handle: '.drag-handle',
        filter: ".ignore-drag", // Prevent dragging boundary layer
        onMove: function (evt) {
            // Prevent dropping after or before boundary layer in a way that displaces it
            if (evt.related && evt.related.className.includes('ignore-drag')) {
                return false;
            }
            return true;
        },
        onEnd: function (evt) {
            // After drop, rebuild stickers based on new DOM order
            const newLayers = [];
            const items = listEl.querySelectorAll("li:not(.ignore-drag)");
            
            // items are from top to bottom (highest visual Z-index to lowest)
            // stickers is from index 0 (bottom) to N (top)
            for (let i = items.length - 1; i >= 0; i--) {
                const oldIdx = parseInt(items[i].dataset.index, 10);
                newLayers.push(stickers[oldIdx]);
            }
            
            // Update activeStickerIndex correctly
            if (activeStickerIndex !== 'boundary' && activeStickerIndex >= 0 && activeStickerIndex < stickers.length) {
                const activeLayer = stickers[activeStickerIndex];
                const newActiveIndex = newLayers.indexOf(activeLayer);
                setActiveSticker(newActiveIndex);
            }
            
            // Update array in place
            stickers.splice(0, stickers.length, ...newLayers);
            
            renderLayerList();
            redrawAll();
        }
    });

    const panel = document.getElementById("sticker-editor-panel");
    if (panel) {
        if (stickers.length > 0) {
            panel.style.display = "flex";
        } else {
            panel.style.display = "none";
        }
    }
}

// Hook into add layer button
document.addEventListener("DOMContentLoaded", () => {
    const addStickerBtn = document.getElementById("add-sticker-btn");
    const fileInput = document.getElementById("file"); // The main file input
    
    if (addStickerBtn && fileInput) {
        addStickerBtn.addEventListener("click", () => {
            fileInput.click();
        });
    }
    
    // We should also call renderLayerList when a layer is added or removed.
    // I'll override addSticker and removeSticker locally or just hook into loadFileAsImage.
});

// --- Canvas Layer Dragging Interaction ---

let isDraggingLayer = false;
let dragStartX = 0;
let dragStartY = 0;
let draggedLayer = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

function hitTestLayers(mouseX, mouseY) {
    const dpr = window.devicePixelRatio || 1;
    // We check from top layer (end of array) to bottom layer (start of array)
    for (let i = stickers.length - 1; i >= 0; i--) {
        const layer = stickers[i];
        if (layer.visible === false) continue;
        
        let left, top, right, bottom;
        
        if (layer.currentCutline && layer.currentCutline.length > 0) {
            const bounds = getPolygonsBounds(layer.currentCutline);
            left = bounds.left + (layer.x || 0);
            top = bounds.top + (layer.y || 0);
            right = bounds.right + (layer.x || 0);
            bottom = bounds.bottom + (layer.y || 0);
        } else if (layer.image || layer.originalImage) {
            const img = layer.image || layer.originalImage;
            left = (layer.x || 0);
            top = (layer.y || 0);
            right = left + (layer.width || img.width);
            bottom = top + (layer.height || img.height);
        } else {
            continue;
        }
        
        // Pad the hit area slightly
        const pad = 10;
        if (mouseX >= left - pad && mouseX <= right + pad &&
            mouseY >= top - pad && mouseY <= bottom + pad) {
            return { index: i, layer: layer };
        }
    }
    return null;
}

document.addEventListener("DOMContentLoaded", () => {
    // Boundary Settings Handlers
    const shapeSelect = document.getElementById("boundaryShapeSelect");
    const marginSlider = document.getElementById("boundaryMarginSlider");
    const marginInput = document.getElementById("boundaryMarginInput");

    if (shapeSelect) {
        shapeSelect.addEventListener("change", (e) => {
            sheetBoundaryConfig.shape = e.target.value;
            redrawAll();
        });
    }

    const updateMargin = (val) => {
        const num = parseFloat(val) || 0;
        sheetBoundaryConfig.margin = isMetric ? (num / 25.4) : num;
        if (marginSlider) marginSlider.value = val;
        if (marginInput) marginInput.value = val;
        redrawAll();
    };

    if (marginSlider) {
        marginSlider.addEventListener("input", (e) => updateMargin(e.target.value));
    }
    if (marginInput) {
        marginInput.addEventListener("input", (e) => updateMargin(e.target.value));
    }

    if (canvas) {
        const getCanvasCoords = (clientX, clientY) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const dpr = window.devicePixelRatio || 1;

            let mouseX = ((clientX - rect.left) * scaleX) / dpr;
            let mouseY = ((clientY - rect.top) * scaleY) / dpr;

            let ppi = 300;
            if (pricingConfig && stickerResolutionSelect) {
                const selectedRes = pricingConfig.resolutions.find(
                    (r) => r.id === (stickerResolutionSelect.value || "dpi_300")
                );
                if (selectedRes) ppi = selectedRes.ppi;
            }
            const ppiScale = ppi / 96;
            const scale = Math.max(currentBounds.width, currentBounds.height) / 500;
            const padding = Math.max(Math.round(60 * ppiScale), Math.round(40 * scale));

            const drawOffsetX = -currentBounds.left + padding;
            const drawOffsetY = -currentBounds.top + padding;

            return {
                x: mouseX - drawOffsetX,
                y: mouseY - drawOffsetY
            };
        };

        const handleDragStart = (clientX, clientY) => {
            if (stickers.length === 0) return false;
            const coords = getCanvasCoords(clientX, clientY);
            const hit = hitTestLayers(coords.x, coords.y);

            if (hit) {
                isDraggingLayer = true;
                draggedLayer = hit.layer;
                setActiveSticker(hit.index);
                renderLayerList();
                renderLayerTabs();

                dragStartX = coords.x;
                dragStartY = coords.y;
                dragOffsetX = hit.layer.x || 0;
                dragOffsetY = hit.layer.y || 0;

                canvas.style.cursor = 'grabbing';
                redrawAll();
                return true;
            }
            return false;
        };

        const handleDragMove = (clientX, clientY) => {
            if (!isDraggingLayer || !draggedLayer) return;
            const coords = getCanvasCoords(clientX, clientY);
            const dx = coords.x - dragStartX;
            const dy = coords.y - dragStartY;

            draggedLayer.x = dragOffsetX + dx;
            draggedLayer.y = dragOffsetY + dy;

            redrawAll();
        };

        const handleDragEnd = () => {
            if (isDraggingLayer) {
                isDraggingLayer = false;
                draggedLayer = null;
                if (canvas) canvas.style.cursor = 'default';
                redrawAll();
            }
        };

        // Mouse listeners
        canvas.addEventListener("mousedown", (e) => {
            handleDragStart(e.clientX, e.clientY);
        });

        window.addEventListener("mousemove", (e) => {
            if (isDraggingLayer) {
                handleDragMove(e.clientX, e.clientY);
            }
        });

        window.addEventListener("mouseup", () => {
            handleDragEnd();
        });

        // Touch listeners
        canvas.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                if (handleDragStart(touch.clientX, touch.clientY)) {
                    e.preventDefault();
                }
            }
        }, { passive: false });

        window.addEventListener("touchmove", (e) => {
            if (isDraggingLayer && e.touches.length === 1) {
                const touch = e.touches[0];
                handleDragMove(touch.clientX, touch.clientY);
                e.preventDefault();
            }
        }, { passive: false });

        window.addEventListener("touchend", () => {
            handleDragEnd();
        });

        window.addEventListener("touchcancel", () => {
            handleDragEnd();
        });

        // Update cursor on hover
        canvas.addEventListener("mousemove", (e) => {
            if (isDraggingLayer) return;
            const coords = getCanvasCoords(e.clientX, e.clientY);
            if (hitTestLayers(coords.x, coords.y)) {
                canvas.style.cursor = 'grab';
            } else {
                canvas.style.cursor = 'default';
            }
        });
    }
});
