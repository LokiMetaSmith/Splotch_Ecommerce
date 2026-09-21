// printshop.js
import "/src/styles.css"; // Or your main CSS file
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import DOMPurify from "dompurify";
import { SvgNest } from "./lib/svgnest.js";
import { SVGParser } from "./lib/svgparser.js";
import { generateCutFile, generatePltFile } from "./lib/cut_file_generator.js";
import * as jose from "jose";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import "svg2pdf.js";
import { Html5Qrcode } from "html5-qrcode";

// --- Global Variables ---
const serverUrl = ""; // Use relative paths for API calls
let authToken;
let csrfToken;
let allOrders = []; // To store a complete list of orders for filtering
let JWKS; // To hold the remote key set verifier
let currentViewMode = 'card';
try {
  currentViewMode = localStorage.getItem('splotchViewMode') || 'card';
} catch {
  // Storage restricted
}
let currentPricingConfig = {};
let pirateShipAutoSync = true;
const svgCache = new Map();
export const expandedOrderIds = new Set();

// Pagination state
let currentPage = 1;
const itemsPerPage = 20;

// --- DOM Elements ---
// A single object to hold all DOM elements for cleaner management
export const ui = {};

// --- Printer & Media Configuration ---
export const PrinterProfiles = {
  custom: { name: "Custom (Manual Entry)", width: 12, height: 12, dpi: 96, isCustom: true, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } },
  roland_bn20: { name: "Roland BN-20", width: 20, height: 20, dpi: 1440, isCustom: false, margins: { top: 1.0, bottom: 1.0, left: 0.5, right: 0.5 } },
  hp_latex_115: { name: "HP Latex 115", width: 54, height: 54, dpi: 1200, isCustom: false, margins: { top: 0.5, bottom: 0.5, left: 0.2, right: 0.2 } },
  epson_surecolor: { name: "Epson SureColor", width: 60, height: 60, dpi: 600, isCustom: false, margins: { top: 0.5, bottom: 0.5, left: 0.1, right: 0.1 } }
};

class ToastManager {
  constructor(element, messageElement, duration = 3000) {
    this.element = element;
    this.messageElement = messageElement;
    this.duration = duration;
    this.timeoutId = null;
    this.isHidden = true;

    if (this.element) {
      // Bind events for pause on hover/focus
      this.element.addEventListener("mouseenter", () => this.pause());
      this.element.addEventListener("mouseleave", () => this.resume());
      this.element.addEventListener("focusin", () => this.pause());
      this.element.addEventListener("focusout", () => this.resume());
    }
  }

  show(message) {
    if (!this.element) return;
    this.messageElement.textContent = message;
    this.element.classList.remove(
      "opacity-0",
      "translate-y-full",
      "pointer-events-none",
    );
    this.isHidden = false;
    this.startTimer();
  }

  hide() {
    if (!this.element) return;
    this.element.classList.add(
      "opacity-0",
      "translate-y-full",
      "pointer-events-none",
    );
    this.isHidden = true;
    this.clearTimer();
  }

  startTimer() {
    this.clearTimer();
    this.timeoutId = setTimeout(() => this.hide(), this.duration);
  }

  clearTimer() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  pause() {
    this.clearTimer();
  }

  resume() {
    if (!this.isHidden) {
      this.startTimer();
    }
  }
}

let errorToastManager;
let successToastManager;

// --- Helper Functions ---

/**
 * Updates the connection status indicator.
 * @param {'connected' | 'error' | 'connecting' | 'idle'} status - The new status.
 */
function updateConnectionStatus(status) {
  const dot = ui.connectionStatusDot;
  const text = ui.connectionStatusText;

  if (!dot || !text) return; // Guard against elements not being ready

  // Reset classes
  dot.classList.remove("bg-green-500", "bg-red-500", "bg-yellow-500");

  switch (status) {
    case "connected":
      dot.classList.add("bg-green-500");
      text.textContent = "Connected";
      dot.setAttribute("aria-label", "Connection Status: Connected");
      break;
    case "error":
      dot.classList.add("bg-red-500");
      text.textContent = "Error";
      dot.setAttribute("aria-label", "Connection Status: Error");
      break;
    case "connecting":
      dot.classList.add("bg-yellow-500");
      text.textContent = "Connecting...";
      dot.setAttribute("aria-label", "Connection Status: Connecting...");
      break;
    default: // idle
      dot.classList.add("bg-yellow-500");
      text.textContent = "Status";
      dot.setAttribute("aria-label", "Connection Status: Idle");
      break;
  }
}

/**
 * Encodes an ArrayBuffer into a Base64URL string.
 * @param {ArrayBuffer} value The buffer to encode.
 * @returns {string} The encoded string.
 */

/**
 * Sets a button to a loading state with an inline spinner.
 * @param {HTMLElement} btn - The button element.
 * @param {boolean} isLoading - Whether the button is loading.
 * @param {string} loadingText - Text to display while loading.
 */
function setButtonLoading(btn, isLoading, loadingText = "Processing...") {
  if (!btn) return;
  if (isLoading) {
    if (!btn.dataset.originalContent) {
      btn.dataset.originalContent = btn.innerHTML;
    }
    btn.disabled = true;

    // Save current width to prevent button from resizing when content changes
    btn.style.width = `${btn.offsetWidth}px`;

    // Add minimal classes just for the loading state, save old classes if needed
    btn.dataset.originalClasses = btn.className;

    // We add some classes for flex layout of the spinner, but we keep existing classes
    // Note: Tailwind classes won't conflict if they aren't the same type, but to be safe,
    // we just add inline-flex items-center justify-center if they aren't there.
    const classesToAdd = ["opacity-75", "cursor-not-allowed"];
    if (
      !btn.classList.contains("flex") &&
      !btn.classList.contains("inline-flex")
    ) {
      classesToAdd.push("inline-flex", "items-center", "justify-center");
    }

    btn.classList.add(...classesToAdd);
    btn.dataset.addedClasses = JSON.stringify(classesToAdd);

    btn.innerHTML = `
            <svg class="animate-spin h-4 w-4 mr-2 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>${loadingText}</span>
        `;
  } else {
    if (btn.dataset.originalContent) {
      btn.innerHTML = btn.dataset.originalContent;
      delete btn.dataset.originalContent;
    }
    btn.disabled = false;
    btn.style.width = ""; // remove fixed width

    if (btn.dataset.addedClasses) {
      const addedClasses = JSON.parse(btn.dataset.addedClasses);
      btn.classList.remove(...addedClasses);
      delete btn.dataset.addedClasses;
    }
  }
}

function bufferEncode(value) {
  if (typeof value === "string") return value;
  return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Safely escapes HTML characters to prevent XSS.
 * @param {string} unsafe - The unsafe string.
 * @returns {string} The escaped string.
 */
function escapeHtml(unsafe) {
  if (unsafe == null) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// The final fetchWithAuth function with robust verification
async function fetchWithAuth(url, options = {}) {
  if (!JWKS) {
    throw new Error("Cannot make requests: JWKS verifier is not available.");
  }

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  // Add CSRF token for state-changing requests
  if (options.method && options.method !== "GET") {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  const storedToken = localStorage.getItem("serverSessionToken");
  const liveToken = response.headers.get("X-Server-Session-Token");

  if (liveToken && storedToken && liveToken !== storedToken) {
    console.warn("New server session token detected. Verifying signature...");
    try {
      // Verify the new token. `jose` automatically uses the `kid` from the
      // token header to find the correct key in the remote JWKS set.
      await jose.jwtVerify(liveToken, JWKS);

      console.log(
        "New token is valid. Server has restarted or rotated keys. Refreshing.",
      );
      localStorage.setItem("serverSessionToken", liveToken);

      localStorage.removeItem("authToken"); // Clear user auth token
      window.location.reload();
      throw new Error("Server restarted.");
    } catch (err) {
      console.error(
        "CRITICAL SECURITY ALERT: Invalid server session token signature! Server identity mismatch.",
        err,
      );
      // If the signature fails, it might be an attacker, OR the server just fully hard-reset its keys
      // while the browser aggressively cached jwks.json.
      // In either case, the safest recovery is to clear local storage and force the user to re-authenticate.
      localStorage.removeItem("serverSessionToken");
      localStorage.removeItem("authToken");
      window.location.reload();
      throw new Error("Invalid server token signature.");
    }
  }

  if (response.status === 401) {
    logout(); // Token is invalid/expired, log out user
    showErrorToast("Session expired. Please log in again.");
    throw new Error("Authentication failed");
  }

  if (!response.ok) {
    let errorMessage = `HTTP error! Status: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData && (errorData.error || errorData.message)) {
        errorMessage = errorData.error || errorData.message;
      }
    } catch {
      try {
        const text = await response.text();
        if (text && text.trim()) {
          errorMessage = text.trim();
        }
      } catch {}
    }
    throw new Error(errorMessage);
  }

  // Handle responses with no content
  if (response.status === 204) {
    return;
  }

  return response.json();
}

// --- Authentication ---

/**
 * Sets the application to a logged-in state.
 * @param {string} token The JWT from the server.
 * @param {string} username The user's name for a welcome message.
 */
function setLoggedInState(token, username) {
  authToken = token;
  localStorage.setItem("authToken", token);

  ui.authStatus.textContent = `Welcome, ${username}!`;
  ui.loginBtn.textContent = "Log Out";
  ui.registerBtn.style.display = "block"; // Show registration button for admins

  // Clear and attach the correct event listener
  ui.loginBtn.removeEventListener("click", showLoginModal);
  ui.loginBtn.addEventListener("click", logout);

  hideLoginModal();
  loadPrintshops().then(() => fetchAndDisplayOrders());
}

/**
 * Sets the application to a logged-out state.
 */
function logout() {
  authToken = null;
  localStorage.removeItem("authToken");

  ui.authStatus.textContent = "";
  ui.loginBtn.textContent = "Login";
  ui.registerBtn.style.display = "none";

  // Clear and attach the correct event listener
  ui.loginBtn.removeEventListener("click", logout);
  ui.loginBtn.addEventListener("click", showLoginModal);

  // Clear existing order cards without destroying the message element
  const orderCards = ui.ordersList.querySelectorAll(".order-card");
  orderCards.forEach((card) => card.remove());

  const noOrdersText = document.getElementById("no-orders-text");
  if (noOrdersText) noOrdersText.textContent = "Please log in to view orders.";
  ui.noOrdersMessage.style.display = "block";

  // Automatically show the login modal if we are logged out
  showLoginModal();
}

/**
 * Handles the WebAuthn (YubiKey) login flow.
 */
async function handleWebAuthnLogin(e) {
  const btn = e
    ? e.submitter || e.currentTarget || e.target.closest("button")
    : ui.webauthnLoginBtn;
  const username = ui.usernameInput.value;
  if (!username) {
    showErrorToast("Please enter your username.");
    return;
  }

  setButtonLoading(btn, true, "Authenticating...");
  try {
    const opts = await fetchWithAuth(
      `${serverUrl}/api/auth/login-options?username=${encodeURIComponent(username)}`,
    );

    if (opts.allowCredentials && opts.allowCredentials.length === 0) {
      hideLoadingIndicator();
      showErrorToast(
        "No security key registered for this user. Please register a key first.",
      );
      return;
    }

    const authResp = await startAuthentication({ optionsJSON: opts });

    const verificationPayload = {
      ...authResp,
      username,
    };

    const verification = await fetchWithAuth(
      `${serverUrl}/api/auth/login-verify`,
      {
        method: "POST",
        body: JSON.stringify(verificationPayload),
      },
    );

    if (verification.verified) {
      setLoggedInState(verification.token, username);
      showSuccessToast("Successfully logged in with Security Key!");
    } else {
      throw new Error(verification.error || "WebAuthn verification failed.");
    }
  } catch (error) {
    if (error.name === "NotAllowedError") {
      showErrorToast("Authentication cancelled or timed out. Please try again.");
    } else {
      showErrorToast(`WebAuthn Login Failed: ${error.message}`);
    }
    console.error(error);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleAddTracking(orderId, btn) {
  const trackingNumber = document.getElementById(
    `tracking-number-${orderId}`,
  ).value;
  const courier = document.getElementById(`courier-${orderId}`).value;

  if (!trackingNumber) {
    showErrorToast("Please enter a tracking number.");
    return;
  }

  setButtonLoading(btn, true, "Saving...");
  try {
    await fetchWithAuth(`${serverUrl}/api/orders/${orderId}/tracking`, {
      method: "POST",
      body: JSON.stringify({ trackingNumber, courier }),
    });
    showSuccessToast("Tracking information added successfully.");
  } catch (error) {
    showErrorToast(`Failed to add tracking info: ${error.message}`);
    console.error(error);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Handles the password login flow.
 */
async function handlePasswordLogin(e) {
  const btn = e
    ? e.submitter || e.currentTarget || e.target.closest("button")
    : ui.passwordLoginBtn;
  const username = ui.usernameInput.value;
  const password = ui.passwordInput.value;

  if (!username || !password) {
    showErrorToast("Username and password are required.");
    return;
  }

  setButtonLoading(btn, true, "Logging in...");
  try {
    const data = await fetchWithAuth(`${serverUrl}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    if (data.token) {
      setLoggedInState(data.token, username);
      showSuccessToast("Login successful!");
    } else {
      throw new Error("Password verification failed.");
    }
  } catch (error) {
    showErrorToast(`Password Login Failed: ${error.message}`);
    console.error(error);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Handles the registration of a new WebAuthn credential.
 */
async function handleRegistration(e) {
  const btn = e
    ? e.submitter || e.currentTarget || e.target.closest("button")
    : ui.webauthnRegisterBtn;
  const username = ui.usernameInput.value;
  if (!username) {
    showErrorToast("Please enter a username to register a key.");
    return;
  }

  setButtonLoading(btn, true, "Registering...");
  try {
    const opts = await fetchWithAuth(`${serverUrl}/api/auth/pre-register`, {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    const regResp = await startRegistration({ optionsJSON: opts });

    const verificationPayload = {
      ...regResp,
      username,
    };

    const verification = await fetchWithAuth(
      `${serverUrl}/api/auth/register-verify`,
      {
        method: "POST",
        body: JSON.stringify(verificationPayload),
      },
    );

    if (verification.verified) {
      showSuccessToast("Security Key registered successfully!");
    } else {
      throw new Error(verification.error || "Registration failed.");
    }
  } catch (error) {
    if (error.name === "NotAllowedError") {
      showErrorToast("Registration cancelled or timed out. Please try again.");
    } else {
      showErrorToast(`Registration Failed: ${error.message}`);
    }
    console.error(error);
  } finally {
    setButtonLoading(btn, false);
  }
}

// --- UI Functions ---

function showLoginModal() {
  ui.loginModal?.classList.remove("hidden");
}
function hideLoginModal() {
  ui.loginModal?.classList.add("hidden");
}
function showLoadingIndicator() {
  ui.loadingIndicator?.classList.remove("hidden");
}
function hideLoadingIndicator() {
  ui.loadingIndicator?.classList.add("hidden");
}
function showErrorToast(message) {
  if (errorToastManager) {
    errorToastManager.show(message);
  } else {
    // Fallback if not initialized
    ui.errorMessage.textContent = message;
    ui.errorToast.classList.remove("hidden");
  }
}
function hideErrorToast() {
  if (errorToastManager) {
    errorToastManager.hide();
  } else {
    ui.errorToast?.classList.add("hidden");
  }
}
function showSuccessToast(message) {
  if (successToastManager) {
    successToastManager.show(message);
  } else {
    ui.successMessage.textContent = message;
    ui.successToast.classList.remove("hidden");
  }
}
function hideSuccessToast() {
  if (successToastManager) {
    successToastManager.hide();
  } else {
    ui.successToast?.classList.add("hidden");
  }
}

// --- Application Logic ---

async function fetchAndDisplayOrders(query = "") {
  const noOrdersText = document.getElementById("no-orders-text");
  if (!authToken) {
    if (noOrdersText)
      noOrdersText.textContent = "Please log in to view orders.";
    updateConnectionStatus("idle");
    return;
  }
  showLoadingIndicator();
  updateConnectionStatus("connecting");
  if (noOrdersText) noOrdersText.textContent = "Loading orders...";
  ui.noOrdersMessage.style.display = "block";

  try {
    const activePrintshop = document.getElementById("active-printshop")?.value;
    let endpoint = query
      ? `${serverUrl}/api/orders/search?q=${encodeURIComponent(query)}`
      : `${serverUrl}/api/orders`;
    
    if (activePrintshop && activePrintshop !== "") {
       const sep = endpoint.includes("?") ? "&" : "?";
       endpoint += `${sep}printshopId=${activePrintshop}`;
    }
    allOrders = await fetchWithAuth(endpoint);
    if (!Array.isArray(allOrders)) allOrders = [];
    // After fetching, display with the current filter (defaults to ACTIVE)
    const activeFilter =
      document.querySelector("#filter-container .filter-btn.active")?.dataset
        .status || "ACTIVE";
    filterAndDisplayOrders(activeFilter);


    updateConnectionStatus("connected");

    await fetchAndDisplayMetrics();
  } catch (error) {
    console.error("[SHOP] Error fetching orders:", error);
    updateConnectionStatus("error");
    // Clear orders but keep message on error
    ui.ordersList.innerHTML = "";
    ui.ordersList.appendChild(ui.noOrdersMessage);

    const noOrdersTextErr = document.getElementById("no-orders-text");

    if (
      error.message.includes("Forbidden") ||
      error.message.includes("permission")
    ) {
      if (noOrdersTextErr)
        noOrdersTextErr.textContent =
          "Access Denied: You must be an administrator to view orders.";
    } else if (error.message !== "Authentication failed") {
      if (noOrdersTextErr)
        noOrdersTextErr.textContent = `Error: Could not load orders (${error.message})`;
      showErrorToast(`Could not fetch orders: ${error.message}`);
    }
  } finally {
    hideLoadingIndicator();
  }
}

async function fetchAndDisplayMetrics() {
  try {
    const metrics = await fetchWithAuth(`${serverUrl}/api/admin/sales-metrics`);
    const elTotalOrders = document.getElementById("metric-total-orders");
    if (elTotalOrders) {
      elTotalOrders.textContent = `${metrics.totalOrders} (${metrics.acceptedOrders} Accepted)`;
    }

    const elTotalRevenue = document.getElementById("metric-total-revenue");
    if (elTotalRevenue)
      elTotalRevenue.textContent = `$${metrics.totalRevenue.toFixed(2)}`;

    const elRecentOrders = document.getElementById("metric-recent-orders");
    if (elRecentOrders) elRecentOrders.textContent = metrics.recentOrders;

    // Also fetch uptime
    const uptimeRes = await fetch(`${serverUrl}/api/ping`);
    if (uptimeRes.ok) {
      const elServerStatus = document.getElementById("metric-server-status");
      if (elServerStatus) {
        elServerStatus.textContent = "Online / Up";
        elServerStatus.classList.remove("text-red-500");
        elServerStatus.classList.add("text-green-500");
      }
    } else {
      throw new Error("Ping failed");
    }
  } catch (e) {
    console.error("Error fetching metrics", e);
    if (e.message.includes("Forbidden") || e.message.includes("permission")) {
      const elTotalOrders = document.getElementById("metric-total-orders");
      if (elTotalOrders) elTotalOrders.textContent = "N/A";
      const elTotalRevenue = document.getElementById("metric-total-revenue");
      if (elTotalRevenue) elTotalRevenue.textContent = "N/A";
      const elRecentOrders = document.getElementById("metric-recent-orders");
      if (elRecentOrders) elRecentOrders.textContent = "N/A";
    }
    const elServerStatus = document.getElementById("metric-server-status");
    if (elServerStatus) {
      elServerStatus.textContent = "Offline";
      elServerStatus.classList.add("text-red-500");
      elServerStatus.classList.remove("text-green-500");
    }
  }
}

/**
 * Filters the global `allOrders` array and renders the matching orders.
 * @param {string} status - The status to filter by (e.g., 'NEW', 'ALL').
 */
function filterAndDisplayOrders(status) {
  // ui.ordersList.innerHTML = ''; // Do NOT clear here, as it removes the message element

  const ordersToDisplay =
    status === "ALL"
      ? allOrders
      : status === "ACTIVE"
      ? allOrders.filter((order) => order.status !== "COMPLETED" && order.status !== "CANCELED" && order.status !== "ARCHIVED" && !order.isArchived)
      : status === "ARCHIVED"
      ? allOrders.filter((order) => order.isArchived || order.status === "ARCHIVED")
      : status === "CANCELED"
      ? allOrders.filter((order) => order.status === "CANCELED" && !order.isArchived)
      : allOrders.filter((order) => order.status === status && !order.isArchived);


  const noOrdersText = document.getElementById("no-orders-text");

  if (ordersToDisplay.length === 0) {
    // Clear orders but keep message
    ui.ordersList.innerHTML = "";
    ui.ordersList.appendChild(ui.noOrdersMessage);

    if (noOrdersText)
      noOrdersText.textContent = `No orders found with status: ${status}.`;
    ui.noOrdersMessage.style.display = "block";
    renderPagination(0);
  } else {
    ui.noOrdersMessage.style.display = "none";

    // Sort newest first
    const sortedOrders = ordersToDisplay.slice().reverse();
    
    // Pagination
    const totalPages = Math.ceil(sortedOrders.length / itemsPerPage);
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedOrders = sortedOrders.slice(startIndex, startIndex + itemsPerPage);

    let html = "";
    if (currentViewMode === "list") {
      html += `
        <div class="overflow-x-auto w-full bg-white rounded-lg shadow-md mb-4">
          <table class="w-full text-sm text-left text-gray-500">
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 border-b">
              <tr>
                <th scope="col" class="px-4 py-3 w-12">Select</th>
                <th scope="col" class="px-4 py-3 w-20">QR</th>
                <th scope="col" class="px-4 py-3">Order Details</th>
                <th scope="col" class="px-4 py-3">Customer</th>
                <th scope="col" class="px-4 py-3">Sticker</th>
                <th scope="col" class="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
      `;
      html += paginatedOrders
        .map((order) => displayOrderRow(order))
        .join("");
      html += `
            </tbody>
          </table>
        </div>
      `;
    } else {
      html = paginatedOrders
        .map((order) => displayOrder(order))
        .join("");
    }

    // Update innerHTML and restore the message element (hidden)
    ui.ordersList.innerHTML = html;
    ui.ordersList.appendChild(ui.noOrdersMessage);
    
    renderPagination(sortedOrders.length);

    // Render QR codes for all displayed orders
    if (window.QRCode) {
      ordersToDisplay.forEach((order) => {
        const canvas = document.getElementById(`qr-${order.orderId}`);
        if (canvas) {
          QRCode.toCanvas(
            canvas,
            order.orderId,
            { width: 100, margin: 1 },
            function (error) {
              if (error) console.error("Error rendering QR Code:", error);
            },
          );
        }
      });
    }
  }
}

// Helper to resolve PPI for an order
export function getResolutionPpi(resolutionId) {
  if (typeof resolutionId === "number" && !isNaN(resolutionId) && resolutionId > 0) {
    return resolutionId;
  }
  if (currentPricingConfig && currentPricingConfig.resolutions) {
    const found = currentPricingConfig.resolutions.find(
      (r) => r.id === resolutionId || r.ppi === resolutionId
    );
    if (found && found.ppi) return Number(found.ppi);
  }
  if (typeof resolutionId === "string") {
    const match = resolutionId.match(/(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  return 300;
}

// --- Production & Dimension Specs Helper ---
/**
 * Resolves comprehensive production specifications for an order:
 * Width, Height, Dimensions, Resolution/PPI, Material, Cut Type, Layers.
 * @param {object} order - The order object.
 * @returns {object} Formatted and raw specification values.
 */
export function getOrderSpecs(order) {
  if (!order) return {};
  const details = order.orderDetails || {};

  // 1. Resolution & PPI
  const rawRes = details.resolution || order.resolution;
  let ppi = getResolutionPpi(rawRes);
  let resolutionName = "";

  if (currentPricingConfig && Array.isArray(currentPricingConfig.resolutions)) {
    const found = currentPricingConfig.resolutions.find(
      (r) => r.id === rawRes || r.ppi === rawRes || String(r.ppi) === String(rawRes)
    );
    if (found) {
      resolutionName = found.name || `${found.ppi} DPI`;
      if (found.ppi) ppi = Number(found.ppi);
    }
  }

  if (!resolutionName) {
    if (typeof rawRes === "string") {
      const match = rawRes.match(/(\d+)/);
      if (match) {
        resolutionName = `${match[1]} DPI`;
      } else {
        resolutionName = rawRes || (ppi ? `${ppi} DPI` : "Standard (300 DPI)");
      }
    } else if (typeof rawRes === "number") {
      resolutionName = `${rawRes} DPI`;
    } else {
      resolutionName = ppi ? `${ppi} DPI` : "300 DPI";
    }
  }

  // 2. Width & Height (in inches)
  let widthInches = null;
  let heightInches = null;

  if (typeof details.widthInches === "number" && !isNaN(details.widthInches)) {
    widthInches = details.widthInches;
  } else if (typeof order.widthInches === "number" && !isNaN(order.widthInches)) {
    widthInches = order.widthInches;
  }

  if (typeof details.heightInches === "number" && !isNaN(details.heightInches)) {
    heightInches = details.heightInches;
  } else if (typeof order.heightInches === "number" && !isNaN(order.heightInches)) {
    heightInches = order.heightInches;
  }

  // From dimensions object
  const dim = details.dimensions || order.dimensions;
  if ((widthInches === null || heightInches === null) && dim) {
    const wPx = typeof dim.width === "number" ? dim.width : (typeof dim.maxX === "number" && typeof dim.minX === "number" ? dim.maxX - dim.minX : null);
    const hPx = typeof dim.height === "number" ? dim.height : (typeof dim.maxY === "number" && typeof dim.minY === "number" ? dim.maxY - dim.minY : null);
    if (wPx !== null && hPx !== null && wPx > 0 && hPx > 0) {
      const effectivePpi = ppi > 0 ? ppi : 300;
      widthInches = Number((wPx / effectivePpi).toFixed(2));
      heightInches = Number((hPx / effectivePpi).toFixed(2));
    }
  }

  // From size string e.g. "3.5\" × 4.2\"" or "3.5 x 4.2"
  const rawSize = details.size || order.size;
  if ((widthInches === null || heightInches === null) && typeof rawSize === "string") {
    const parts = rawSize.replace(/[^\d.\s×x]/g, "").split(/[×x]/i);
    if (parts.length === 2) {
      const pW = parseFloat(parts[0].trim());
      const pH = parseFloat(parts[1].trim());
      if (!isNaN(pW) && !isNaN(pH) && pW > 0 && pH > 0) {
        if (widthInches === null) widthInches = pW;
        if (heightInches === null) heightInches = pH;
      }
    }
  }

  const formattedWidth = widthInches !== null ? `${widthInches}"` : "N/A";
  const formattedHeight = heightInches !== null ? `${heightInches}"` : "N/A";
  const formattedSize = (widthInches !== null && heightInches !== null)
    ? `${widthInches}" × ${heightInches}"`
    : (rawSize || "N/A");

  const areaSqIn = (widthInches !== null && heightInches !== null)
    ? Number((widthInches * heightInches).toFixed(2))
    : null;

  // Material
  const rawMat = details.material || order.material || "Standard";
  let materialName = rawMat;
  if (currentPricingConfig && Array.isArray(currentPricingConfig.materials)) {
    const foundMat = currentPricingConfig.materials.find((m) => m.id === rawMat);
    if (foundMat && foundMat.name) materialName = foundMat.name;
  }
  if (materialName === "pp_standard") materialName = "Standard White Vinyl";
  if (materialName === "vinyl_gloss") materialName = "Glossy Vinyl";
  if (materialName === "vinyl_matte") materialName = "Matte Vinyl";

  // Cut Type
  const rawCut = details.cutType || order.cutType || "die_cut";
  const cutTypeName = rawCut === "kiss_cut" ? "Kiss Cut" : "Die Cut";

  // Custom Layers
  const customLayers = Array.isArray(details.customLayers) ? details.customLayers : [];
  const numLayers = details.numImageLayers || (customLayers.length > 0 ? customLayers.length : 1);

  return {
    widthInches,
    heightInches,
    formattedWidth,
    formattedHeight,
    formattedSize,
    areaSqIn,
    resolutionName,
    ppi,
    materialName,
    cutTypeName,
    customLayers,
    numLayers,
  };
}

// --- Start Table Row View ---
export function displayOrderRow(order) {
  const orderId = order.orderId;
  const isExpanded = expandedOrderIds.has(orderId);
  const specs = getOrderSpecs(order);
  const receivedAt = new Date(order.receivedAt).toLocaleString();
  const quantity = order.orderDetails?.quantity || order.quantity || 0;
  const price = (order.amount / 100).toFixed(2);

  const billingName = `${escapeHtml(order.billingContact?.givenName || "")} ${escapeHtml(order.billingContact?.familyName || "")}`.trim() || escapeHtml(order.customerDetails?.billing?.name || "N/A");
  const billingEmail = escapeHtml(order.billingContact?.email || order.customerDetails?.billing?.email || order.customerEmail || "N/A");
  const shippingName = `${escapeHtml(order.shippingContact?.givenName || "")} ${escapeHtml(order.shippingContact?.familyName || "")}`.trim() || escapeHtml(order.customerDetails?.shipping?.name || billingName);
  const shippingEmail = escapeHtml(order.shippingContact?.email || billingEmail);

  const formatAddress = (contact) => {
    if (!contact) return "";
    const lines = Array.isArray(contact.addressLines) ? contact.addressLines.filter(Boolean).join(", ") : (contact.addressLines || "");
    const cityStateZip = [contact.locality || contact.city, contact.administrativeDistrictLevel1 || contact.state, contact.postalCode].filter(Boolean).join(" ");
    return [lines, cityStateZip].filter(Boolean).join(", ");
  };
  const shippingAddrStr = escapeHtml(formatAddress(order.shippingContact));
  const billingAddrStr = escapeHtml(formatAddress(order.billingContact));
  const hasDistinctBilling = billingAddrStr && shippingAddrStr && (billingAddrStr.toLowerCase() !== shippingAddrStr.toLowerCase());

  const serverPrefix = serverUrl;
  const designImagePath = `${serverPrefix}${escapeHtml(order.designImagePath || "")}`;
  const cutFilePath = escapeHtml(
    order.orderDetails?.cutLinePath || order.cutLinePath || "",
  );
  const pltFilePath = order.pltFile ? `${serverPrefix}${order.pltFile}` : null;

  const isLocalPickup = order.deliveryMethod === 'pickup' || order.orderDetails?.deliveryMethod === 'pickup';
  const deliveryBadge = isLocalPickup
    ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Local Pickup</span>`
    : `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700">Ship to Address</span>`;

  const statuses = [
    "NEW",
    "ACCEPTED",
    "PRINTING",
    "HOLD_FOR_PICKUP",
    "SHIPPED",
    "DELIVERED",
    "COMPLETED",
    "CANCELED",
    "ARCHIVED",
  ];
  const statusColors = {
    NEW: "bg-blue-100 text-blue-800",
    ACCEPTED: "bg-amber-100 text-amber-800",
    PRINTING: "bg-purple-100 text-purple-800",
    HOLD_FOR_PICKUP: "bg-orange-100 text-orange-800",
    SHIPPED: "bg-yellow-100 text-yellow-800",
    DELIVERED: "bg-green-100 text-green-800",
    COMPLETED: "bg-gray-100 text-gray-800",
    CANCELED: "bg-red-100 text-red-800",
    ARCHIVED: "bg-gray-200 text-gray-800",
  };
  const alert = getOrderAlert(order);
  const alertHtml = alert ? `<div class="inline-flex items-center gap-1 mt-1 text-[10px] px-1.5 py-0.5 rounded border ${alert.classes}">${alert.icon} ${alert.text}</div>` : "";
  
  const statusClass =
    statusColors[order.status?.toUpperCase()] || "bg-gray-500 text-white";

  const formatStatusLabel = (s) => s === "HOLD_FOR_PICKUP" ? "Hold for Pickup" : (s.charAt(0) + s.slice(1).toLowerCase());

  let retentionBadge = "";
  if (order.isArchived || order.status === "ARCHIVED") {
    retentionBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-300" title="Order is archived. All order metadata, specifications, and history are preserved.${order.artworkPruned ? ' Artwork files pruned.' : ''}">Archived${order.artworkPruned ? ' (Pruned)' : ''}</span>`;
  } else if (order.status === "CANCELED") {
    const canceledTime = order.shadowDeletedAt
      ? new Date(order.shadowDeletedAt).getTime()
      : new Date(order.lastUpdatedAt || order.receivedAt).getTime();
    const elapsedDays = Math.floor((Date.now() - canceledTime) / (24 * 60 * 60 * 1000));
    const remainingDays = Math.max(0, 30 - elapsedDays);
    retentionBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200" title="Canceled orders are automatically archived after 30 days. Order metadata is permanently preserved.">Archives in ${remainingDays}d</span>`;
  }

  const dropdownHtml = `
    <select class="action-dropdown border rounded-md p-1 text-sm bg-white ${statusClass}" data-order-id="${orderId}">
        ${statuses.map((s) => `<option value="${s}" ${order.status === s ? "selected" : ""}>${formatStatusLabel(s)}</option>`).join("")}
    </select>
  `;

  const isShippable = !isLocalPickup && order.status !== "CANCELED" && order.status !== "COMPLETED" && order.status !== "DELIVERED" && order.status !== "ARCHIVED" && !order.isArchived;
  const defaultWeight = order.packageWeightOz ?? (order.orderDetails?.quantity ? Math.max(1, Math.round(order.orderDetails.quantity * 0.05 * 10) / 10) : 1);
  const defaultLength = order.packageDimensions?.length ?? 6;
  const defaultWidth = order.packageDimensions?.width ?? 4;
  const defaultHeight = order.packageDimensions?.height ?? 0.5;

  const packageControlsHtml = isShippable ? `
    <div class="p-3 bg-purple-50/60 rounded-md border border-purple-200 package-panel" data-order-id="${orderId}">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span class="text-xs font-bold text-purple-900 flex items-center gap-1">
          <span>📦</span> Package &amp; Shipping Label
          ${!pirateShipAutoSync ? '<span class="ml-1 text-[10px] font-normal bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">Manual Queue</span>' : ''}
        </span>
        <div class="flex items-center gap-2">
          ${order.exportToPirateship || order.labelRequested ? `
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-800 bg-purple-100 px-2 py-0.5 rounded border border-purple-300">
              <span class="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse"></span>
              Queued for Pirate Ship
            </span>
          ` : ''}
          ${order.labelUrl ? `
            <a href="${escapeHtml(order.labelUrl)}" target="_blank" class="text-xs text-blue-600 hover:text-blue-800 font-semibold underline flex items-center gap-1">
              📄 View Label
            </a>
          ` : ''}
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Weight (oz)</label>
          <input type="number" step="0.1" min="0.1" max="1000" class="package-weight-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultWeight}">
        </div>
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Length (in)</label>
          <input type="number" step="0.1" min="0.1" max="100" class="package-length-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultLength}">
        </div>
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Width (in)</label>
          <input type="number" step="0.1" min="0.1" max="100" class="package-width-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultWidth}">
        </div>
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Height (in)</label>
          <input type="number" step="0.1" min="0.1" max="100" class="package-height-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultHeight}">
        </div>
      </div>
      <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-purple-100">
        <p class="text-[11px] text-gray-500">
          ${pirateShipAutoSync
            ? 'Package specifications will be synced with Pirate Ship upon order import.'
            : 'Click <strong>Order Label</strong> to queue this order for Pirate Ship with these dimensions.'}
        </p>
        <button type="button" class="order-label-btn px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold flex items-center gap-1 shadow-sm transition-colors cursor-pointer" data-order-id="${orderId}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>
          ${order.labelRequested || order.exportToPirateship ? 'Update / Order Label' : 'Order Label'}
        </button>
      </div>
    </div>
  ` : '';

  return `
    <tr class="bg-white border-b hover:bg-blue-50/40 order-row cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/60' : ''}" data-order-id="${orderId}" title="Click to ${isExpanded ? 'collapse' : 'expand'} order specifications">
      <td class="px-4 py-3">
        <div class="flex items-center gap-1.5">
          <button type="button" class="order-expand-toggle-btn p-1 text-gray-400 hover:text-blue-600 focus:outline-none rounded transition-transform duration-200 ${isExpanded ? 'rotate-90 text-blue-600' : ''}" data-order-id="${orderId}" title="${isExpanded ? 'Collapse order' : 'Expand order'}" aria-label="Toggle details for order ${orderId}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
          <input type="checkbox" class="order-select-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500" value="${orderId}">
        </div>
      </td>
      <td class="px-4 py-3">
        <div class="qr-code-container w-12 h-12" data-order-id="${orderId}">
            <canvas id="qr-${orderId}" width="48" height="48"></canvas>
        </div>
      </td>
      <td class="px-4 py-3">
        <div class="font-bold text-gray-900 flex items-center gap-1">
          <span>${orderId.substring(0, 8)}...</span>
        </div>
        <div class="text-xs text-gray-500">${receivedAt}</div>
        <div class="flex items-center gap-1.5 mt-1">
          ${deliveryBadge}
          ${alertHtml}
        </div>
        <div class="mt-1 font-semibold text-green-600">$${price}</div>
      </td>
      <td class="px-4 py-3">
        <div class="font-medium text-gray-900">${billingName}</div>
        <div class="text-xs text-gray-500"><a href="mailto:${billingEmail}" class="hover:underline">${billingEmail}</a></div>
        <div class="mt-1">
          <button type="button" class="copy-address-btn text-[11px] text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 cursor-pointer" data-order-id="${orderId}" title="Copy formatted shipping address">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
            Copy Address
          </button>
        </div>
      </td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-2">
            ${designImagePath && order.designImagePath ? `<a href="${designImagePath}" target="_blank" class="block w-12 h-12 bg-gray-100 rounded overflow-hidden flex-shrink-0 sticker-peel-container">
                <img src="${designImagePath}" alt="Design" class="sticker-design w-full h-full object-contain" data-cut-file-path="${cutFilePath}" data-quantity="${quantity}" data-ppi="${specs.ppi}" loading="lazy" decoding="async">
            </a>` : `<div class="block w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-[10px] text-gray-500 font-semibold text-center leading-tight p-1">${order.artworkPruned ? 'Pruned' : 'N/A'}</div>`}
            <div>
                <div class="text-xs font-semibold">Qty: ${quantity}</div>
                <div class="text-[11px] text-gray-500 mt-0.5">${specs.formattedSize}</div>
                ${cutFilePath ? `<a href="${serverPrefix}${cutFilePath}" target="_blank" download class="text-[10px] text-blue-600 hover:underline inline-block mt-1">Download SVG</a>` : ""}
                ${pltFilePath ? `<a href="${pltFilePath}" target="_blank" download class="text-[10px] text-blue-600 hover:underline inline-block ml-1 mt-1">Download PLT</a>` : ""}
            </div>
        </div>
      </td>
      <td class="px-4 py-3">
        <div class="flex flex-col gap-2">
            ${dropdownHtml}
            <div class="flex items-center gap-1.5 mt-0.5">
                ${retentionBadge}
                <button type="button" class="view-order-history-btn px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-[11px] font-semibold border border-gray-300 flex items-center gap-1 shadow-sm transition-colors" data-order-id="${orderId}">
                    <svg class="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    History
                </button>
            </div>
            ${order.exportToPirateship || order.labelRequested ? `
              <div class="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1 w-fit">
                <span class="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse"></span>
                Queued for Pirate Ship
              </div>
            ` : ""}

            <div class="mt-2 text-xs flex flex-col gap-1 tracking-inputs" style="display: ${order.status === 'SHIPPED' || order.status === 'DELIVERED' || order.status === 'COMPLETED' ? 'flex' : 'none'};" data-order-id="${orderId}">
               <select class="border rounded p-1 tracking-courier bg-white" data-order-id="${orderId}">
                   <option value="USPS" ${order.courier === 'USPS' ? 'selected' : ''}>USPS</option>
                   <option value="UPS" ${order.courier === 'UPS' ? 'selected' : ''}>UPS</option>
                   <option value="FedEx" ${order.courier === 'FedEx' ? 'selected' : ''}>FedEx</option>
                   <option value="DHL" ${order.courier === 'DHL' ? 'selected' : ''}>DHL</option>
               </select>
               <input type="text" placeholder="Tracking #" value="${escapeHtml(order.trackingNumber || '')}" class="border rounded p-1 tracking-number bg-white" data-order-id="${orderId}">
            </div>
        </div>
      </td>
    </tr>

    <!-- Expanded Row Details -->
    <tr class="order-expanded-row bg-slate-50/90 border-b border-blue-100 ${isExpanded ? '' : 'hidden'}" id="order-expanded-${orderId}" data-order-id="${orderId}">
      <td colspan="6" class="p-0">
        <div class="p-4 sm:p-6 border-l-4 border-blue-500 bg-gradient-to-r from-blue-50/40 via-white to-white space-y-4 shadow-inner">
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-200">
            <div class="flex items-center gap-3">
              <h4 class="text-base font-bold text-gray-900">
                Order <span class="font-mono text-splotch-red font-semibold">${orderId}</span>
              </h4>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${statusClass}">${order.status === 'HOLD_FOR_PICKUP' ? 'Hold for Pickup' : order.status}</span>
              ${deliveryBadge}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500">Ordered: ${receivedAt}</span>
              <button type="button" class="view-order-history-btn px-2.5 py-1 bg-white hover:bg-gray-100 text-gray-700 rounded text-xs font-semibold border border-gray-300 flex items-center gap-1 shadow-sm transition-colors" data-order-id="${orderId}">
                <svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                History
              </button>
            </div>
          </div>

          <!-- Production Specs Banner -->
          <div>
            <h5 class="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Production &amp; Sticker Specifications</h5>
            <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Width</span>
                <span class="text-base font-bold text-gray-900 order-dim-width" data-order-id="${orderId}">${specs.formattedWidth}</span>
              </div>
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Height</span>
                <span class="text-base font-bold text-gray-900 order-dim-height" data-order-id="${orderId}">${specs.formattedHeight}</span>
              </div>
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Dimensions</span>
                <span class="text-sm font-bold text-gray-900 order-dim-size" data-order-id="${orderId}">${specs.formattedSize}</span>
                ${specs.areaSqIn ? `<span class="text-[10px] text-gray-500 block order-dim-area" data-order-id="${orderId}">(${specs.areaSqIn} sq in)</span>` : ''}
              </div>
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Resolution</span>
                <span class="text-sm font-bold text-blue-700 block">${escapeHtml(specs.resolutionName)}</span>
                <span class="text-[10px] text-gray-500 block">${specs.ppi} PPI</span>
              </div>
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Material</span>
                <span class="text-xs font-semibold text-gray-800 block truncate" title="${escapeHtml(specs.materialName)}">${escapeHtml(specs.materialName)}</span>
              </div>
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Cut Type</span>
                <span class="text-xs font-semibold text-gray-800 block">${escapeHtml(specs.cutTypeName)}</span>
              </div>
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Quantity</span>
                <span class="text-base font-bold text-gray-900">${quantity}</span>
              </div>
              <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold block">Total Amount</span>
                <span class="text-base font-bold text-green-700">$${price}</span>
              </div>
            </div>
            ${order.promoCode ? `
              <div class="mt-2 p-2 bg-indigo-50 border border-indigo-200 rounded-md flex items-center gap-2 text-xs">
                <span class="font-semibold text-indigo-900">Promo Code:</span>
                <span class="font-mono font-bold text-indigo-700 bg-white px-1.5 py-0.5 rounded border border-indigo-300">${escapeHtml(order.promoCode)}</span>
                ${order.promoDiscountCents ? `<span class="text-indigo-600 font-medium">Discount applied: -$${(order.promoDiscountCents / 100).toFixed(2)}</span>` : ''}
              </div>
            ` : ''}
          </div>

          <!-- Customer and Delivery Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-white p-3.5 rounded-lg border border-gray-200">
            <div>
              <h6 class="font-bold text-gray-800 mb-1">Billing Details</h6>
              <p><span class="text-gray-500">Name:</span> <strong>${billingName}</strong></p>
              <p><span class="text-gray-500">Email:</span> <a href="mailto:${billingEmail}" class="text-blue-600 hover:underline">${billingEmail}</a></p>
              ${hasDistinctBilling ? `<div class="mt-1 p-1.5 bg-amber-50 rounded border border-amber-200 text-gray-700"><span class="font-semibold text-amber-900">Billing Address:</span> ${billingAddrStr}</div>` : ''}
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <h6 class="font-bold text-gray-800">${isLocalPickup ? 'Pickup Details' : 'Shipping Details'}</h6>
                ${!isLocalPickup && shippingAddrStr ? `
                  <button type="button" class="copy-address-btn text-[11px] text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 cursor-pointer" data-order-id="${orderId}" title="Copy formatted shipping address">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    Copy Address
                  </button>
                ` : ''}
              </div>
              <p><span class="text-gray-500">Name:</span> <strong>${shippingName}</strong></p>
              <p><span class="text-gray-500">Email:</span> <a href="mailto:${shippingEmail}" class="text-blue-600 hover:underline">${shippingEmail}</a></p>
              ${shippingAddrStr ? `<div class="mt-1 p-1.5 bg-blue-50/50 rounded border border-blue-100 text-gray-700"><span class="font-semibold text-blue-900">${isLocalPickup ? 'Pickup Location:' : 'Address:'}</span> ${shippingAddrStr}</div>` : ''}
            </div>
          </div>

          <!-- Package & Shipping Controls -->
          ${packageControlsHtml}

          <!-- Footer / Actions / Logging -->
          <div class="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-gray-200">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-gray-600">Status:</span>
              ${dropdownHtml}
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="font-semibold text-gray-600">Log Time:</span>
              <input type="text" class="border rounded p-1 text-xs time-log-desc" data-order-id="${orderId}" placeholder="Task Description">
              <input type="number" class="border rounded p-1 text-xs w-16 time-log-duration" data-order-id="${orderId}" placeholder="Mins">
              <button class="bg-gray-600 hover:bg-gray-700 text-white px-2.5 py-1 rounded text-xs log-time-btn" data-order-id="${orderId}">Log</button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}
// --- End Table Row View ---

/**
 * Renders a single order card into an HTML string.
 * Bolt Optimization: Returns string instead of DOM element for performance.
 * @param {object} order - The order object from the server.
 * @returns {string} The created order card HTML string.
 */
export function displayOrder(order) {
  // Bolt Optimization: Return cached HTML if available and status hasn't changed
  if (order._cachedHtml && order._cachedStatus === order.status) {
    return order._cachedHtml;
  }

  const formattedAmount = order.amount
    ? `$${(order.amount / 100).toFixed(2)}`
    : "N/A";
  const receivedDate = new Date(order.receivedAt).toLocaleString();

  const billingName = `${escapeHtml(order.billingContact?.givenName || "")} ${escapeHtml(order.billingContact?.familyName || "")}`;
  const billingEmail = escapeHtml(order.billingContact?.email || "N/A");

  const shippingName = `${escapeHtml(order.shippingContact?.givenName || "")} ${escapeHtml(order.shippingContact?.familyName || "")}`;
  const shippingEmail = escapeHtml(order.shippingContact?.email || "N/A");

  const formatAddress = (contact) => {
    if (!contact) return "";
    const lines = Array.isArray(contact.addressLines) ? contact.addressLines.filter(Boolean).join(", ") : (contact.addressLines || "");
    const cityStateZip = [contact.locality || contact.city, contact.administrativeDistrictLevel1 || contact.state, contact.postalCode].filter(Boolean).join(" ");
    return [lines, cityStateZip].filter(Boolean).join(", ");
  };
  const shippingAddrStr = escapeHtml(formatAddress(order.shippingContact));
  const billingAddrStr = escapeHtml(formatAddress(order.billingContact));
  const hasDistinctBilling = billingAddrStr && shippingAddrStr && (billingAddrStr.toLowerCase() !== shippingAddrStr.toLowerCase());

  const specs = getOrderSpecs(order);
  const quantity = escapeHtml(order.orderDetails?.quantity || "N/A");
  const ppi = specs.ppi || getResolutionPpi(order.orderDetails?.resolution || order.resolution);
  const status = escapeHtml(order.status);
  const orderId = escapeHtml(order.orderId);
  // Truncate BEFORE escaping would be safer for logic, but since orderId is UUID (safe chars),
  // and escapeHtml changes '&' to '&amp;', we should truncate the raw ID if we want exactly 8 chars.
  const orderIdShort = escapeHtml(order.orderId.substring(0, 8));

  // Status badges styling class
  const statusColors = {
    NEW: "bg-blue-100 text-blue-800",
    ACCEPTED: "bg-amber-100 text-amber-800",
    PRINTING: "bg-purple-100 text-purple-800",
    HOLD_FOR_PICKUP: "bg-orange-100 text-orange-800",
    SHIPPED: "bg-yellow-100 text-yellow-800",
    DELIVERED: "bg-green-100 text-green-800",
    COMPLETED: "bg-gray-100 text-gray-800",
    CANCELED: "bg-red-100 text-red-800",
    ARCHIVED: "bg-gray-200 text-gray-800",
  };
  const alert = getOrderAlert(order);
  const alertHtml = alert ? `<span class="inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded border ${alert.classes}">${alert.icon} ${alert.text}</span>` : "";

  const statusClass =
    statusColors[status.toUpperCase()] || "bg-gray-500 text-white";

  const designImagePath = `${serverUrl}${escapeHtml(order.designImagePath)}`;
  const cutFilePath = escapeHtml(
    order.orderDetails?.cutLinePath || order.cutLinePath || "",
  );

  const stickerName = escapeHtml(
    order.orderDetails?.stickerName || "Custom Sticker",
  );
  const material = escapeHtml(order.orderDetails?.material || "unknown");

  // Action Dropdown
  const statuses = [
    "ACCEPTED",
    "PRINTING",
    "HOLD_FOR_PICKUP",
    "SHIPPED",
    "DELIVERED",
    "COMPLETED",
    "CANCELED",
    "ARCHIVED",
  ];
  const formatStatusLabel = (s) => s === "HOLD_FOR_PICKUP" ? "Hold for Pickup" : (s.charAt(0) + s.slice(1).toLowerCase());
  const dropdownHtml = `
        <select class="action-dropdown border rounded p-1 text-sm font-bold ${statusClass} mt-4" data-order-id="${orderId}">
            ${statuses.map((s) => `<option value="${s}" ${status === s ? "selected" : ""}>${formatStatusLabel(s)}</option>`).join("")}
        </select>
    `;

  // Tracking section
  const trackingDisplay = order.status === "SHIPPED" ? "block" : "none";
  const courierOptions = ["usps", "ups", "fedex"]
    .map((c) => `<option value="${c}">${c.toUpperCase()}</option>`)
    .join("");

  const isLocalPickup = order.deliveryMethod === 'pickup' || order.orderDetails?.deliveryMethod === 'pickup';
  const deliveryBadge = isLocalPickup
    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Local Pickup</span>`
    : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">Ship to Address</span>`;

  let retentionBadge = "";

  if (order.isArchived || status === "ARCHIVED") {
    retentionBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-300 shadow-sm" title="Order is archived. All order specifications, pricing, and history are preserved.${order.artworkPruned ? ' Artwork files pruned.' : ''}">Archived${order.artworkPruned ? ' (Pruned)' : ''}</span>`;
  } else if (status === "CANCELED") {
    const canceledTime = order.shadowDeletedAt
      ? new Date(order.shadowDeletedAt).getTime()
      : new Date(order.lastUpdatedAt || order.receivedAt).getTime();
    const elapsedDays = Math.floor((Date.now() - canceledTime) / (24 * 60 * 60 * 1000));
    const remainingDays = Math.max(0, 30 - elapsedDays);
    retentionBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200 shadow-sm" title="Canceled orders are automatically archived after 30 days. Order metadata is permanently preserved.">Archives in ${remainingDays}d</span>`;
  }

  const isShippable = !isLocalPickup && status !== "CANCELED" && status !== "COMPLETED" && status !== "DELIVERED" && status !== "ARCHIVED" && !order.isArchived;
  const defaultWeight = order.packageWeightOz ?? (order.orderDetails?.quantity ? Math.max(1, Math.round(order.orderDetails.quantity * 0.05 * 10) / 10) : 1);
  const defaultLength = order.packageDimensions?.length ?? 6;
  const defaultWidth = order.packageDimensions?.width ?? 4;
  const defaultHeight = order.packageDimensions?.height ?? 0.5;

  const packageControlsHtml = isShippable ? `
    <div class="mt-4 p-3 bg-purple-50/60 rounded-md border border-purple-200 package-panel" data-order-id="${orderId}">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span class="text-xs font-bold text-purple-900 flex items-center gap-1">
          <span>📦</span> Package &amp; Shipping Label
          ${!pirateShipAutoSync ? '<span class="ml-1 text-[10px] font-normal bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">Manual Queue</span>' : ''}
        </span>
        <div class="flex items-center gap-2">
          ${order.exportToPirateship || order.labelRequested ? `
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-800 bg-purple-100 px-2 py-0.5 rounded border border-purple-300">
              <span class="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse"></span>
              Queued for Pirate Ship
            </span>
          ` : ''}
          ${order.labelUrl ? `
            <a href="${escapeHtml(order.labelUrl)}" target="_blank" class="text-xs text-blue-600 hover:text-blue-800 font-semibold underline flex items-center gap-1">
              📄 View Label
            </a>
          ` : ''}
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Weight (oz)</label>
          <input type="number" step="0.1" min="0.1" max="1000" class="package-weight-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultWeight}">
        </div>
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Length (in)</label>
          <input type="number" step="0.1" min="0.1" max="100" class="package-length-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultLength}">
        </div>
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Width (in)</label>
          <input type="number" step="0.1" min="0.1" max="100" class="package-width-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultWidth}">
        </div>
        <div>
          <label class="block text-[11px] text-gray-600 font-medium mb-0.5">Height (in)</label>
          <input type="number" step="0.1" min="0.1" max="100" class="package-height-input w-full p-1 border border-gray-300 rounded text-xs bg-white" data-order-id="${orderId}" value="${defaultHeight}">
        </div>
      </div>

      <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-purple-100">
        <p class="text-[11px] text-gray-500">
          ${pirateShipAutoSync
            ? 'Package specifications will be synced with Pirate Ship upon order import.'
            : 'Click <strong>Order Label</strong> to queue this order for Pirate Ship with these dimensions.'}
        </p>
        <button type="button" class="order-label-btn px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold flex items-center gap-1 shadow-sm transition-colors cursor-pointer" data-order-id="${orderId}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>
          ${order.labelRequested || order.exportToPirateship ? 'Update / Order Label' : 'Order Label'}
        </button>
      </div>
    </div>
  ` : '';

  const html = `
    <div class="order-card border-l-4 ${statusClass.split(" ")[0].replace("bg-", "border-")}" id="order-card-${orderId}">
        <div class="flex justify-between items-start">
            <div class="flex items-start">
                <input type="checkbox" class="order-select-checkbox mt-1 mr-3 w-5 h-5 cursor-pointer rounded text-blue-600 focus:ring-blue-500 shadow-sm" data-order-id="${orderId}">
                <div>
                    <h3 class="text-xl text-splotch-red">Order ID: <span class="font-mono text-sm">${orderIdShort}...</span></h3>
                    <p class="text-sm text-gray-600">Received: ${escapeHtml(receivedDate)}</p>
                    <div class="flex items-center gap-2 mt-1">
                        ${deliveryBadge}
                        ${alertHtml}
                        ${retentionBadge}
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" class="view-order-history-btn px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-xs font-semibold border border-gray-300 flex items-center gap-1 shadow-sm transition-colors" data-order-id="${orderId}">
                    <svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    History
                </button>
                <div class="${statusClass} font-bold py-1 px-3 rounded-full text-sm" id="status-badge-${orderId}">${status === 'HOLD_FOR_PICKUP' ? 'HOLD FOR PICKUP' : status}</div>
            </div>
        </div>


        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 order-details">
            <div>
                <dt>Billing Name:</dt><dd>${billingName}</dd>
                <dt>Billing Email:</dt><dd>${billingEmail}</dd>
                ${hasDistinctBilling ? `<dt class="mt-1 font-semibold text-amber-800">Billing Address:</dt><dd class="text-xs text-gray-700 bg-amber-50 p-1.5 rounded border border-amber-200 mt-0.5">${billingAddrStr}</dd>` : ""}
            </div>
            <div>
                <dt>Shipping Name:</dt><dd>${shippingName}</dd>
                <dt>Shipping Email:</dt><dd>${shippingEmail}</dd>
                ${shippingAddrStr ? `
                  <dt class="mt-1 font-semibold text-blue-800 flex items-center justify-between">
                    <span>${isLocalPickup ? 'Pickup Location:' : 'Shipping Address:'}</span>
                    ${!isLocalPickup ? `
                      <button type="button" class="copy-address-btn text-xs text-blue-600 hover:text-blue-800 font-normal hover:underline inline-flex items-center gap-1 cursor-pointer" data-order-id="${orderId}" title="Copy formatted shipping address">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                        Copy Address
                      </button>` : ''}
                  </dt>
                  <dd class="text-xs text-gray-700 bg-blue-50/50 p-1.5 rounded border border-blue-100 mt-0.5">${shippingAddrStr}</dd>
                ` : ""}
            </div>
            <div>
                <dt>Sticker Name:</dt><dd>${stickerName}</dd>
                <dt>Dimensions (W × H):</dt><dd class="font-semibold text-gray-900 order-dim-size" data-order-id="${orderId}">${specs.formattedSize}${specs.areaSqIn ? ` <span class="text-xs text-gray-500 font-normal order-dim-area" data-order-id="${orderId}">(${specs.areaSqIn} sq in)</span>` : ""}</dd>
                <dt>Width:</dt><dd class="font-medium text-gray-800 order-dim-width" data-order-id="${orderId}">${specs.formattedWidth}</dd>
                <dt>Height:</dt><dd class="font-medium text-gray-800 order-dim-height" data-order-id="${orderId}">${specs.formattedHeight}</dd>
                <dt>Resolution:</dt><dd class="font-medium text-blue-700">${escapeHtml(specs.resolutionName)}${specs.ppi ? ` <span class="text-xs text-gray-500 font-normal">(${specs.ppi} PPI)</span>` : ""}</dd>
                <dt>Material:</dt><dd>${escapeHtml(specs.materialName)}</dd>
            </div>
            <div>
                <dt>Cut Type:</dt><dd class="font-medium text-gray-800">${escapeHtml(specs.cutTypeName)}</dd>
                <dt>Quantity:</dt><dd class="font-bold text-gray-900">${quantity}</dd>
                <dt>Amount:</dt><dd class="font-bold text-green-700">${escapeHtml(formattedAmount)}</dd>
                ${specs.numLayers > 1 ? `<dt>Layers:</dt><dd class="text-gray-700">${specs.numLayers} layers</dd>` : ""}
                ${order.promoCode ? `<dt class="text-indigo-700 font-semibold mt-1">Promo Code:</dt><dd class="text-xs text-indigo-800 font-mono font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 inline-block mt-0.5">${escapeHtml(order.promoCode)}${order.promoDiscountCents ? ` (-$${(order.promoDiscountCents / 100).toFixed(2)})` : ''}</dd>` : ""}
            </div>
        </div>

        <div class="mt-4">
            <dt>Sticker Design:</dt>
            ${designImagePath && order.designImagePath ? `<a class="sticker-peel-container" href="${designImagePath}" target="_blank">
                <img class="sticker-design" src="${designImagePath}" alt="Sticker Design" data-cut-file-path="${cutFilePath}" data-quantity="${quantity}" data-ppi="${ppi}" loading="lazy" decoding="async">
            </a>` : `<div class="w-24 h-24 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-500 font-semibold p-2 text-center">${order.artworkPruned ? 'Artwork Pruned' : 'No Preview'}</div>`}
            ${cutFilePath ? `<div class="mt-2"><dt>Cut File:</dt><dd><a href="${serverUrl}${cutFilePath}" class="text-blue-500 underline text-sm" target="_blank" download>Download SVG / XML</a></dd></div>` : ""}
        </div>

        <div class="mt-2 flex flex-wrap gap-2">
            ${dropdownHtml}
        </div>

        ${packageControlsHtml}

        <div class="mt-4" id="tracking-info-${orderId}" style="display: ${trackingDisplay};">
            <input class="border rounded-md p-2" type="text" id="tracking-number-${orderId}" placeholder="Enter Tracking Number">
            <select class="border rounded-md p-2" id="courier-${orderId}">
                ${courierOptions}
            </select>
            <button class="add-tracking-btn" data-order-id="${orderId}">Add Tracking</button>
        </div>

        <div class="mt-4 border-t pt-2">
            <h4 class="font-bold text-sm mb-1 text-gray-600">Log Time (Odoo)</h4>
            <div class="flex items-center gap-2">
                <input type="text" class="border rounded p-1 text-sm flex-grow time-log-desc" data-order-id="${orderId}" placeholder="Task Description">
                <input type="number" class="border rounded p-1 text-sm w-20 time-log-duration" data-order-id="${orderId}" placeholder="Mins">
                <button class="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm log-time-btn" data-order-id="${orderId}">Log</button>
            </div>
        </div>

        <div class="mt-4 border-t pt-2 flex items-center justify-between">
            <div class="text-sm text-gray-600">
                <strong>QR Tracking Code</strong>
            </div>
            <div class="qr-code-container bg-white p-1 rounded border shadow-sm" data-order-id="${orderId}">
                <!-- QR Code will be injected here after render -->
                <canvas id="qr-${orderId}" width="100" height="100"></canvas>
            </div>
        </div>
    </div>
    `;

  // Cache the result
  order._cachedHtml = html;
  order._cachedStatus = order.status;

  return html;
}

/**
 * Handles clicks on the orders list for event delegation.
 * @param {Event} e - The click event.
 */
function handleOrderListClick(e) {
  const trackingBtn = e.target.closest(".add-tracking-btn");
  if (trackingBtn) {
    const orderId = trackingBtn.dataset.orderId;
    handleAddTracking(orderId, trackingBtn);
    return;
  }

  const timeLogBtn = e.target.closest(".log-time-btn");
  if (timeLogBtn) {
    const orderId = timeLogBtn.dataset.orderId;
    handleTimeLog(orderId, timeLogBtn);
    return;
  }

  const historyBtn = e.target.closest(".view-order-history-btn");
  if (historyBtn) {
    const orderId = historyBtn.dataset.orderId;
    openOrderHistoryModal(orderId);
    return;
  }

  const copyAddressBtn = e.target.closest(".copy-address-btn");
  if (copyAddressBtn) {
    const orderId = copyAddressBtn.dataset.orderId;
    copyShippingAddress(orderId, copyAddressBtn);
    return;
  }

  const orderLabelBtn = e.target.closest(".order-label-btn");
  if (orderLabelBtn) {
    const orderId = orderLabelBtn.dataset.orderId;
    orderShippingLabel(orderId, orderLabelBtn);
    return;
  }

  // Handle per-order expansion in list view
  const toggleBtn = e.target.closest(".order-expand-toggle-btn");
  const orderRow = e.target.closest(".order-row");
  if (toggleBtn || orderRow) {
    const isInteractive = e.target.closest(
      "button:not(.order-expand-toggle-btn), a, input, select, textarea, label, .sticker-peel-container, .qr-code-container, .tracking-inputs"
    );
    if (!isInteractive) {
      const orderId = (toggleBtn || orderRow).dataset.orderId;
      if (orderId) {
        toggleOrderExpansion(orderId);
        return;
      }
    }
  }
}

/**
 * Toggles expanded details view for an order in list view.
 * @param {string} orderId - The order ID to toggle.
 */
export function toggleOrderExpansion(orderId) {
  if (!orderId) return;
  const isExpanded = expandedOrderIds.has(orderId);
  if (isExpanded) {
    expandedOrderIds.delete(orderId);
  } else {
    expandedOrderIds.add(orderId);
  }

  const expandedRow = document.getElementById(`order-expanded-${orderId}`);
  const parentRow = document.querySelector(`.order-row[data-order-id="${orderId}"]`);
  const chevronBtn = parentRow?.querySelector(".order-expand-toggle-btn");

  if (expandedRow) {
    if (isExpanded) {
      expandedRow.classList.add("hidden");
      parentRow?.classList.remove("bg-blue-50/60");
      chevronBtn?.classList.remove("rotate-90", "text-blue-600");
    } else {
      expandedRow.classList.remove("hidden");
      parentRow?.classList.add("bg-blue-50/60");
      chevronBtn?.classList.add("rotate-90", "text-blue-600");

      // Render QR code inside expanded row if QRCode is available
      if (window.QRCode) {
        const canvas = document.getElementById(`qr-${orderId}`);
        if (canvas) {
          QRCode.toCanvas(
            canvas,
            orderId,
            { width: 100, margin: 1 },
            function (error) {
              if (error) console.error("Error rendering QR Code:", error);
            }
          );
        }
      }
    }
  }
}

async function openOrderHistoryModal(orderId) {
  const modal = document.getElementById("order-history-modal");
  const modalTitle = document.getElementById("history-modal-order-id");
  const modalBody = document.getElementById("history-modal-body");

  if (!modal || !modalBody) return;

  if (modalTitle) modalTitle.textContent = `Order ID: ${orderId}`;
  modalBody.innerHTML = `
    <div class="flex items-center justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      <span class="ml-3 text-sm text-gray-500">Fetching audit log...</span>
    </div>
  `;
  modal.classList.remove("hidden");

  try {
    const data = await fetchWithAuth(`${serverUrl}/api/orders/${orderId}/history`);
    const history = data?.history || [];

    if (history.length === 0) {
      modalBody.innerHTML = `
        <div class="text-center py-6 text-gray-500 text-sm">
          No recorded transition history found for this order.
        </div>
      `;
      return;
    }

    const formatSt = (s) => s === "HOLD_FOR_PICKUP" ? "Hold for Pickup" : (s ? s.charAt(0) + s.slice(1).toLowerCase() : "Initial Creation");

    // Sort newest first
    const sorted = history.slice().reverse();

    let html = `<div class="relative border-l-2 border-blue-200 ml-4 space-y-6">`;
    for (const evt of sorted) {
      const dateStr = new Date(evt.timestamp).toLocaleString();
      const fromSt = evt.fromStatus ? formatSt(evt.fromStatus) : "Initial Creation";
      const toSt = formatSt(evt.toStatus);
      const actorLabel = evt.actor ? `${evt.actor.type.toUpperCase()}: ${evt.actor.id}` : "Unknown";

      let statusColor = "bg-blue-100 text-blue-800 border-blue-300";
      if (evt.toStatus === "CANCELED" || evt.toStatus === "PURGED") statusColor = "bg-red-100 text-red-800 border-red-300";
      else if (evt.toStatus === "ARCHIVED") statusColor = "bg-gray-200 text-gray-800 border-gray-400";
      else if (evt.toStatus === "COMPLETED" || evt.toStatus === "DELIVERED") statusColor = "bg-green-100 text-green-800 border-green-300";
      else if (evt.toStatus === "SHIPPED") statusColor = "bg-emerald-100 text-emerald-800 border-emerald-300";
      else if (evt.toStatus === "HOLD_FOR_PICKUP") statusColor = "bg-orange-100 text-orange-800 border-orange-300";

      html += `
        <div class="relative pl-6">
          <span class="absolute -left-2.5 top-1.5 w-5 h-5 rounded-full border-2 border-white bg-blue-500 flex items-center justify-center">
            <span class="w-2 h-2 rounded-full bg-white"></span>
          </span>
          <div class="bg-gray-50 p-3.5 rounded-lg border border-gray-200 shadow-sm text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-bold text-gray-800">${fromSt} &rarr; <span class="px-2 py-0.5 rounded text-xs border font-bold ${statusColor}">${toSt}</span></span>
              <span class="text-xs text-gray-500">${dateStr}</span>
            </div>
            <div class="mt-2 text-xs text-gray-600 flex items-center gap-1">
              <span class="font-semibold text-gray-700">Actor:</span>
              <span class="font-mono bg-white px-1.5 py-0.5 rounded border border-gray-200">${escapeHtml(actorLabel)}</span>
            </div>
            ${evt.note ? `<div class="mt-1 text-xs text-gray-600"><span class="font-semibold">Note:</span> ${escapeHtml(evt.note)}</div>` : ""}
            ${evt.metadata?.trackingNumber ? `<div class="mt-1 text-xs text-gray-600"><span class="font-semibold">Tracking:</span> ${escapeHtml(evt.metadata.courier || "")} ${escapeHtml(evt.metadata.trackingNumber)}</div>` : ""}
          </div>
        </div>
      `;
    }
    html += `</div>`;

    if (data.isArchived) {
      html += `
        <div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          <strong>Archived Order:</strong> This order is permanently archived. All specifications, customer details, pricing, and audit transition history are preserved.${data.artworkPruned ? " Heavy uploaded artwork files were pruned to save disk storage." : ""}
        </div>
      `;
    } else if (data.isPurged) {
      html += `
        <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          <strong>Notice:</strong> This order was purged from the active database under the legacy 30-day retention rule, but its audit record is preserved in the non-volatile journal.
        </div>
      `;
    }

    modalBody.innerHTML = html;
  } catch (err) {
    modalBody.innerHTML = `
      <div class="p-4 bg-red-50 text-red-700 rounded-md text-sm">
        Failed to load order history: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

function closeOrderHistoryModal() {
  const modal = document.getElementById("order-history-modal");
  if (modal) modal.classList.add("hidden");
}


function handleOrderListChange(e) {
  const actionDropdown = e.target.closest(".action-dropdown");
  if (actionDropdown) {
    const orderId = actionDropdown.dataset.orderId;
    const status = actionDropdown.value;

    if (status === "CANCELED") {
      const confirmed = window.confirm(
        "Are you sure you want to cancel this order? This action cannot be undone.",
      );
      if (!confirmed) {
        // Revert selection visually by re-rendering
        filterAndDisplayOrders(
          document.querySelector("#filter-container .filter-btn.active")
            ?.dataset.status || "ALL",
        );
        return;
      }
    }

    const payload = { status };

    if (status === 'SHIPPED') {
        const trackingInput = document.querySelector(`.tracking-number[data-order-id="${orderId}"]`);
        const courierInput = document.querySelector(`.tracking-courier[data-order-id="${orderId}"]`);
        if (trackingInput && trackingInput.value.trim()) {
            payload.trackingNumber = trackingInput.value.trim();
        }
        if (courierInput && courierInput.value) {
            payload.courier = courierInput.value;
        }
    }

    updateOrderStatus(orderId, payload, actionDropdown);
  }

  const orderCheckbox = e.target.closest(".order-select-checkbox");
  if (orderCheckbox) {
    const checkedCount = ui.ordersList?.querySelectorAll(".order-select-checkbox:checked").length || 0;
    if (checkedCount > 0 && ui.nestedSvgContainer?.innerHTML.includes("Please select at least one order")) {
      ui.nestedSvgContainer.innerHTML = "";
    }
    const nestBtn = ui.nestStickersBtn || document.getElementById("nestStickersBtn");
    if (nestBtn && nestBtn.disabled && !nestBtn.dataset.busy) {
      setButtonLoading(nestBtn, false);
    }
  }
}

async function handleTimeLog(orderId, btn) {
  const descInput = document.querySelector(
    `.time-log-desc[data-order-id="${orderId}"]`,
  );
  const durInput = document.querySelector(
    `.time-log-duration[data-order-id="${orderId}"]`,
  );

  if (!descInput || !durInput) return;

  const description = descInput.value.trim();
  const duration = parseInt(durInput.value, 10);

  if (!description) {
    showErrorToast("Description required.");
    return;
  }
  if (!duration || duration <= 0) {
    showErrorToast("Valid duration (minutes) required.");
    return;
  }

  setButtonLoading(btn, true, "Logging...");
  try {
    await fetchWithAuth(`${serverUrl}/api/orders/${orderId}/time-log`, {
      method: "POST",
      body: JSON.stringify({ description, duration }),
    });
    showSuccessToast("Time logged successfully to Odoo.");
    descInput.value = "";
    durInput.value = "";
  } catch (err) {
    showErrorToast(`Failed to log time: ${err.message}`);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Sends a request to the server to update an order's status.
 * @param {string} orderId The ID of the order to update.
 * @param {Object|string} payload The new status for the order, or an object with {status, trackingNumber, courier}.
 */
async function updateOrderStatus(orderId, payload, btn) {
  setButtonLoading(btn, true, "Updating...");
  const body = typeof payload === 'string' ? { status: payload } : payload;
  const newStatus = body.status;

  try {
    await fetchWithAuth(`${serverUrl}/api/orders/${orderId}/status`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    // Update the order in our local cache
    const orderIndex = allOrders.findIndex((o) => o.orderId === orderId);
    if (orderIndex !== -1) {
      allOrders[orderIndex].status = newStatus;
      if (body.trackingNumber) allOrders[orderIndex].trackingNumber = body.trackingNumber;
      if (body.courier) allOrders[orderIndex].courier = body.courier;
    }

    showSuccessToast(`Order status updated to ${newStatus}.`);

    // Re-filter the list to reflect the change
    const activeFilter =
      document.querySelector("#filter-container .filter-btn.active")?.dataset
        .status || "ALL";
    filterAndDisplayOrders(activeFilter);
  } catch (error) {
    showErrorToast(`Update Failed: ${error.message}`);
    console.error(error);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleBulkStatusUpdate(newStatus) {
  const checkboxes = document.querySelectorAll('.order-select-checkbox:checked');
  if (checkboxes.length === 0) {
    showErrorToast("No orders selected for bulk update.");
    return;
  }
  
  const orderIds = Array.from(checkboxes).map(cb => cb.dataset.orderId || cb.value);
  const selectElement = document.getElementById("bulk-status-select");
  setButtonLoading(selectElement, true, "Updating...");
  
  try {
    const res = await fetchWithAuth(`${serverUrl}/api/admin/orders/bulk-status`, {
      method: "POST",
      body: JSON.stringify({ orderIds, status: newStatus }),
    });
    
    // Update the local cache
    orderIds.forEach(id => {
      const orderIndex = allOrders.findIndex(o => o.orderId === id);
      if (orderIndex !== -1) {
        allOrders[orderIndex].status = newStatus;
      }
    });
    
    showSuccessToast(`Successfully updated ${res.updatedCount} orders to ${newStatus}.`);
    
    // Uncheck all after bulk action
    document.querySelectorAll('.order-select-checkbox').forEach(cb => cb.checked = false);
    selectElement.value = "";
    
    // Re-filter the list to reflect the changes
    const activeFilter =
      document.querySelector("#filter-container .filter-btn.active")?.dataset
        .status || "ALL";
    filterAndDisplayOrders(activeFilter);
  } catch (error) {
    showErrorToast(`Bulk Update Failed: ${error.message}`);
    console.error(error);
  } finally {
    setButtonLoading(selectElement, false);
  }
}

// --- Camera QR Code & Barcode Scanning Functions ---

let html5QrCodeScanner = null;
let isCameraScanning = false;
let lastScannedCode = null;
let lastScannedTime = 0;

function playScanSuccessSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {}
}

function extractOrderIdFromScan(text) {
  if (!text) return "";
  let clean = text.trim();
  try {
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      const url = new URL(clean);
      const queryId =
        url.searchParams.get("orderId") ||
        url.searchParams.get("id") ||
        url.searchParams.get("order");
      if (queryId) return queryId.trim();
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        return segments[segments.length - 1].trim();
      }
    }
  } catch {}
  if (clean.toUpperCase().startsWith("ORDER:")) {
    return clean.substring(6).trim();
  }
  return clean;
}

async function processScannedCode(rawText) {
  const query = extractOrderIdFromScan(rawText);
  if (!query) return;

  const now = Date.now();
  if (query === lastScannedCode && now - lastScannedTime < 3000) {
    // Debounce duplicate scans within 3 seconds
    return;
  }
  lastScannedCode = query;
  lastScannedTime = now;

  // Visual feedback overlay flash
  const overlay = document.getElementById("scan-feedback-overlay");
  if (overlay) {
    overlay.classList.remove("hidden");
    setTimeout(() => overlay.classList.add("hidden"), 800);
  }

  playScanSuccessSound();

  // Find order in memory
  let matchingOrders = allOrders.filter(
    (o) => o.orderId === query || o.orderId.includes(query),
  );

  // If not found in current list, search backend
  if (matchingOrders.length === 0) {
    await fetchAndDisplayOrders(query);
    matchingOrders = allOrders.filter(
      (o) => o.orderId === query || o.orderId.includes(query),
    );
  }

  if (matchingOrders.length === 1) {
    const targetStatus =
      document.getElementById("scanTargetStatus")?.value || "PRINTING";
    const orderId = matchingOrders[0].orderId;
    try {
      await fetchWithAuth(`${serverUrl}/api/orders/${orderId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: targetStatus }),
      });

      const orderIndex = allOrders.findIndex((o) => o.orderId === orderId);
      if (orderIndex !== -1) {
        allOrders[orderIndex].status = targetStatus;
      }
      showSuccessToast(
        `Scan Mode: Updated ${orderId.substring(0, 8)} to ${targetStatus}`,
      );

      // Refresh display
      const activeFilter =
        document.querySelector("#filter-container .filter-btn.active")
          ?.dataset.status || "ALL";
      filterAndDisplayOrders(activeFilter);

      if (ui.searchInput) {
        ui.searchInput.value = "";
      }
    } catch (error) {
      showErrorToast(`Scan Mode Update Failed: ${error.message}`);
    }
  } else if (matchingOrders.length > 1) {
    showErrorToast("Scan Mode: Multiple orders match. Please refine search.");
  } else {
    showErrorToast(`Scan Mode: No order found for "${query}".`);
  }
}

async function startCameraScanner() {
  const qrReaderElem = document.getElementById("qr-reader");
  if (!qrReaderElem) return;

  const statusText = document.getElementById("scan-status-text");
  const statusIndicator = document.getElementById("scan-status-indicator");
  const toggleBtnText = document.getElementById("toggleCameraBtnText");

  try {
    if (!html5QrCodeScanner) {
      html5QrCodeScanner = new Html5Qrcode("qr-reader");
    }

    if (isCameraScanning) return;

    if (statusText) statusText.textContent = "Starting camera...";
    if (statusIndicator) {
      statusIndicator.className =
        "inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse";
    }

    await html5QrCodeScanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const edge = Math.max(180, Math.floor(minEdge * 0.75));
          return { width: edge, height: edge };
        },
      },
      (decodedText) => {
        processScannedCode(decodedText);
      },
      () => {
        // Continuous frame misses are expected and ignored
      },
    );

    isCameraScanning = true;
    if (toggleBtnText) toggleBtnText.textContent = "Stop Camera";
    if (statusText)
      statusText.textContent = "Camera active — point at order QR code";
    if (statusIndicator) {
      statusIndicator.className =
        "inline-block w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse";
    }
  } catch (error) {
    console.error("Camera scanner start error:", error);
    isCameraScanning = false;
    if (toggleBtnText) toggleBtnText.textContent = "Start Camera";
    if (statusText)
      statusText.textContent = `Camera error: ${error.message || "Permission denied"}`;
    if (statusIndicator) {
      statusIndicator.className =
        "inline-block w-2.5 h-2.5 rounded-full bg-red-500";
    }
    showErrorToast(
      `Camera Scanner Error: ${error.message || "Could not open camera"}`,
    );
  }
}

async function stopCameraScanner() {
  if (html5QrCodeScanner && isCameraScanning) {
    try {
      await html5QrCodeScanner.stop();
    } catch (e) {
      console.warn("Error stopping camera scanner:", e);
    }
    isCameraScanning = false;
  }
  const toggleBtnText = document.getElementById("toggleCameraBtnText");
  const statusText = document.getElementById("scan-status-text");
  const statusIndicator = document.getElementById("scan-status-indicator");
  if (toggleBtnText) toggleBtnText.textContent = "Start Camera";
  if (statusText) statusText.textContent = "Camera stopped";
  if (statusIndicator) {
    statusIndicator.className =
      "inline-block w-2.5 h-2.5 rounded-full bg-gray-400";
  }
}

async function handleSearch() {
  const query = ui.searchInput.value.trim();
  if (!query) {
    fetchAndDisplayOrders();
    return;
  }

  // If Scan Mode is active, route through scan update processor
  const scanModeBanner = document.getElementById("scan-mode-banner");
  if (scanModeBanner && !scanModeBanner.classList.contains("hidden")) {
    await processScannedCode(query);
  } else {
    await fetchAndDisplayOrders(query);
  }
}

let scanBuffer = "";
let scanTimeout;

function handleBarcodeScan(e) {
  const scanModeBanner = document.getElementById("scan-mode-banner");
  if (scanModeBanner && !scanModeBanner.classList.contains("hidden")) {
    // Only intercept if we are NOT already typing in an input box
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      if (e.key === "Enter") {
        if (scanBuffer.length > 0) {
          processScannedCode(scanBuffer);
          scanBuffer = "";
        }
      } else if (e.key.length === 1) {
        scanBuffer += e.key;
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          scanBuffer = "";
        }, 500);
      }
    }
  }
}

async function handleNesting(e) {
  const btn = e
    ? e.currentTarget || e.target.closest("button")
    : ui.nestStickersBtn;

  // Grab all checked order cards and then find their sticker-design elements
  const checkedCheckboxes = Array.from(
    ui.ordersList?.querySelectorAll(".order-select-checkbox:checked") || [],
  );
  const svgElements = checkedCheckboxes
    .map((cb) => {
      const orderContainer = cb.closest(".order-card, .order-row");
      return orderContainer ? orderContainer.querySelector(".sticker-design") : null;
    })
    .filter((img) => img !== null);

  if (svgElements.length === 0) {
    if (ui.nestedSvgContainer) {
      ui.nestedSvgContainer.innerHTML =
        '<p class="text-red-500 font-bold">Please select at least one order to nest.</p>';
    }
    showErrorToast("Please select at least one order to nest.");
    hideLoadingIndicator();
    if (btn) setButtonLoading(btn, false);
    return;
  }

  setButtonLoading(btn, true, "Nesting...");
  if (ui.nestedSvgContainer) {
    ui.nestedSvgContainer.innerHTML = "<p>Nesting in progress...</p>";
  }

  try {
    // Get the current measurement unit and determine the conversion factor to inches
    const unit = document.getElementById("measurement-unit")?.value || "inches";
    const toInches = unit === "mm" ? (1 / 25.4) : 1;

    // 1. Generate the complex bin polygon
    const isRollMedia = document.getElementById("rollMedia")?.checked || false;
    const sheetWidthInches = (parseFloat(document.getElementById("sheetWidth")?.value) || 12) * toInches;
    let sheetHeightInches = (parseFloat(document.getElementById("sheetHeight")?.value) || 12) * toInches;
    if (isRollMedia) {
        sheetHeightInches = 1200; // 100 feet virtual canvas for roll packing
    }
    const binWidth = sheetWidthInches * 96; 
    let binHeight = sheetHeightInches * 96; 
    const scale = 10000; // Use a high scale for precision

    const cpr = new ClipperLib.Clipper();
    const subj = [
      { X: 0, Y: 0 },
      { X: binWidth * scale, Y: 0 },
      { X: binWidth * scale, Y: binHeight * scale },
      { X: 0, Y: binHeight * scale },
    ];
    cpr.AddPath(subj, ClipperLib.PolyType.ptSubject, true);

    const clip = [];
    // Add edge margins (convert to inches, then to pixels at 96 DPI)
    const marginTop =
      (parseFloat(document.getElementById("marginTop").value) || 0) * toInches * 96;
    const marginBottom =
      (parseFloat(document.getElementById("marginBottom").value) || 0) * toInches * 96;
    const marginLeft =
      (parseFloat(document.getElementById("marginLeft").value) || 0) * toInches * 96;
    const marginRight =
      (parseFloat(document.getElementById("marginRight").value) || 0) * toInches * 96;

    // Top margin as a keep-out
    clip.push([
      { X: -10, Y: -10 },
      { X: (binWidth + 10) * scale, Y: -10 },
      { X: (binWidth + 10) * scale, Y: marginTop * scale },
      { X: -10, Y: marginTop * scale },
    ]);
    // Bottom margin
    clip.push([
      { X: -10, Y: (binHeight - marginBottom) * scale },
      { X: (binWidth + 10) * scale, Y: (binHeight - marginBottom) * scale },
      { X: (binWidth + 10) * scale, Y: (binHeight + 10) * scale },
      { X: -10, Y: (binHeight + 10) * scale },
    ]);
    // Left margin
    clip.push([
      { X: -10, Y: -10 },
      { X: marginLeft * scale, Y: -10 },
      { X: marginLeft * scale, Y: (binHeight + 10) * scale },
      { X: -10, Y: (binHeight + 10) * scale },
    ]);
    // Right margin
    clip.push([
      { X: (binWidth - marginRight) * scale, Y: -10 },
      { X: (binWidth + 10) * scale, Y: -10 },
      { X: (binWidth + 10) * scale, Y: (binHeight + 10) * scale },
      { X: (binWidth - marginRight) * scale, Y: (binHeight + 10) * scale },
    ]);

    const addPrintingMarks = document.getElementById("addPrintingMarks")?.checked || false;

    // Add internal keep-outs
    const keepoutAreasText = document.getElementById("keepoutAreas")?.value || "[]";
    let keepoutAreas = [];
    try {
      keepoutAreas = JSON.parse(keepoutAreasText);
    } catch (_) {
      keepoutAreas = [];
    }
    keepoutAreas.forEach((area) => {
      clip.push([
        { X: area.x * scale, Y: area.y * scale },
        { X: (area.x + area.width) * scale, Y: area.y * scale },
        { X: (area.x + area.width) * scale, Y: (area.y + area.height) * scale },
        { X: area.x * scale, Y: (area.y + area.height) * scale },
      ]);
    });

    if (addPrintingMarks) {
      // Protect corner fiducial marks, QR codes, and tracking code text from sticker placement
      // Top-Left: fiducial cx=60, cy=60, QR x=90..170, text x=185..280
      clip.push([
        { X: -10, Y: -10 },
        { X: 300 * scale, Y: -10 },
        { X: 300 * scale, Y: 110 * scale },
        { X: -10, Y: 110 * scale },
      ]);
      // Top-Right: fiducial cx=binWidth-60, cy=60
      clip.push([
        { X: (binWidth - 100) * scale, Y: -10 },
        { X: (binWidth + 10) * scale, Y: -10 },
        { X: (binWidth + 10) * scale, Y: 100 * scale },
        { X: (binWidth - 100) * scale, Y: 100 * scale },
      ]);
      // Bottom-Left: fiducial cx=60, cy=binHeight-60
      clip.push([
        { X: -10, Y: (binHeight - 100) * scale },
        { X: 100 * scale, Y: (binHeight - 100) * scale },
        { X: 100 * scale, Y: (binHeight + 10) * scale },
        { X: -10, Y: (binHeight + 10) * scale },
      ]);
      // Bottom-Right: fiducial cx=binWidth-60, cy=binHeight-60, QR x=binWidth-170..binWidth-90, text x=binWidth-185
      clip.push([
        { X: (binWidth - 300) * scale, Y: (binHeight - 110) * scale },
        { X: (binWidth + 10) * scale, Y: (binHeight - 110) * scale },
        { X: (binWidth + 10) * scale, Y: (binHeight + 10) * scale },
        { X: (binWidth - 300) * scale, Y: (binHeight + 10) * scale },
      ]);
    }

    cpr.AddPaths(clip, ClipperLib.PolyType.ptClip, true);

    const solution = new ClipperLib.Paths();
    cpr.Execute(
      ClipperLib.ClipType.ctDifference,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    );

    const complexBinPolygon = solution[0].map((p) => ({
      x: p.X / scale,
      y: p.Y / scale,
    }));

    // 2. Fetch and prepare the sticker SVGs
    const svgPromises = svgElements.map(async (img) => {
      const cutFilePath = img.dataset.cutFilePath;
      console.log(
        "BROWSER LOG: Processing img.src=",
        img.src,
        "cutFilePath=",
        cutFilePath,
      );
      const cacheKey = cutFilePath || img.src;

      if (svgCache.has(cacheKey)) {
        return svgCache.get(cacheKey);
      }

      const promise = (async () => {
        let cutlineSvgText = "";
        if (cutFilePath) {
          cutlineSvgText = await (
            await fetch(`${serverUrl}${cutFilePath}`, {
              credentials: "include",
            })
          ).text();
        } else {
          const svgString = await (
            await fetch(img.src, { credentials: "include" })
          ).text();
          cutlineSvgText = generateCutFile(svgString, getCutSettings());
        }

        // Fetch the PNG and convert to base64
        const pngResponse = await fetch(img.src, { credentials: "include" });
        const pngBlob = await pngResponse.blob();
        const pngBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(pngBlob);
        });

        const domParser = new DOMParser();
        const cutlineDoc = domParser.parseFromString(
          cutlineSvgText,
          "image/svg+xml",
        );
        const cutlineRoot = cutlineDoc.documentElement;
        const rawWidth = parseFloat(cutlineRoot.getAttribute("width")) || 100;
        const rawHeight = parseFloat(cutlineRoot.getAttribute("height")) || 100;
        let viewBox = cutlineRoot.getAttribute("viewBox");
        if (!viewBox) {
          viewBox = `0 0 ${rawWidth} ${rawHeight}`;
        }

        const ppi = parseFloat(img.dataset.ppi) || parseFloat(cutlineRoot.getAttribute("data-ppi")) || 300;
        const scaleFactor = 96 / ppi;
        const scaledW = rawWidth * scaleFactor;
        const scaledH = rawHeight * scaleFactor;

        const availW = binWidth - marginLeft - marginRight;
        const availH = binHeight - marginTop - marginBottom;
        
        if (!isNaN(scaledW) && !isNaN(scaledH)) {
          const fitsNormal = scaledW <= availW && scaledH <= availH;
          const fitsRotated = scaledW <= availH && scaledH <= availW;
          if (!fitsNormal && !fitsRotated) {
            const orderId = img.closest('.order-row, .order-card')?.dataset?.orderId || "unknown";
            throw new Error(`Sticker for order ${orderId.substring(0, 8)} (${(scaledW/96).toFixed(2)}x${(scaledH/96).toFixed(2)}in) is too large for the printable area (${(availW/96).toFixed(2)}x${(availH/96).toFixed(2)}in). Please reduce margins or use a larger sheet.`);
          }
        }

        const unifiedSvg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        unifiedSvg.setAttribute("width", String(scaledW));
        unifiedSvg.setAttribute("height", String(scaledH));
        unifiedSvg.setAttribute("viewBox", viewBox);

        const group = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        group.setAttribute("class", "nest-group");
        group.setAttribute("data-scale", String(scaleFactor));

        const childNodes = Array.from(cutlineRoot.children || cutlineRoot.childNodes)
          .filter((node) => node.nodeType === 1); // ELEMENT_NODE

        let hasCmykOrImage = false;
        childNodes.forEach((child) => {
          const id = child.getAttribute("id") || "";
          if (id === "Cmyk_art_Layer" || child.tagName.toLowerCase() === "image" || child.querySelector("image")) {
            hasCmykOrImage = true;
          }
        });

        const getLayerPriority = (el) => {
          const id = (el.getAttribute("id") || "").toLowerCase();
          const tag = el.tagName.toLowerCase();
          if (id.includes("white")) return 1;
          if (id.includes("inlay")) return 2;
          if (id.includes("cmyk") || tag === "image" || el.querySelector("image")) return 3;
          if (id.includes("clear")) return 4;
          if (id.includes("kiss")) return 10;
          if (id.includes("die")) return 11;
          return 12;
        };

        const elementsToAppend = [];

        if (!hasCmykOrImage) {
          const imageEl = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "image",
          );
          imageEl.setAttribute("href", pngBase64);
          imageEl.setAttribute("width", String(rawWidth));
          imageEl.setAttribute("height", String(rawHeight));

          if (viewBox) {
            const parts = viewBox.split(/[\s,]+/);
            if (parts.length === 4) {
              imageEl.setAttribute("x", parts[0]);
              imageEl.setAttribute("y", parts[1]);
              imageEl.setAttribute("width", parts[2]);
              imageEl.setAttribute("height", parts[3]);
            }
          }
          elementsToAppend.push({ el: imageEl, priority: 3 });
        }

        childNodes.forEach((child) => {
          const clone = child.cloneNode(true);
          const priority = getLayerPriority(clone);
          const isCutline = priority >= 10 || (!clone.getAttribute("id") && clone.tagName.toLowerCase() === "path");
          if (isCutline) {
            clone.setAttribute("class", (clone.getAttribute("class") || "") + " cut-line-element");
          }
          elementsToAppend.push({ el: clone, priority });
        });

        // Ensure proper layer order: White_Layer (1) -> Inlay (2) -> CMYK/Art (3) -> Clear (4) -> Kiss-Cut (10) -> Die-Cut (11)
        elementsToAppend.sort((a, b) => a.priority - b.priority);

        elementsToAppend.forEach((item) => {
          group.appendChild(item.el);
        });

        unifiedSvg.appendChild(group);
        return new XMLSerializer().serializeToString(unifiedSvg);
      })();

      svgCache.set(cacheKey, promise);
      // Handle error by removing from cache so next try can succeed
      promise.catch(() => svgCache.delete(cacheKey));

      return promise;
    });
    const svgStrings = await Promise.all(svgPromises);

    // 3. Set up and run SVGNest
    const parser = new SVGParser();
    const svgs = [];
    for (let i = 0; i < svgStrings.length; i++) {
      const quantity = parseInt(svgElements[i].dataset.quantity, 10) || 1;
      for (let q = 0; q < quantity; q++) {
        svgs.push(parser.load(svgStrings[i]));
      }
    }

    const spacing = parseInt(ui.spacingInput.value, 10) || 0;
    const options = { 
      spacing, 
      rotations: 4, 
      addPrintingMarks, // Generates corner crop marks around placed stickers
      onProgress: (msg) => {
        ui.nestedSvgContainer.innerHTML = `<p>${msg}</p>`;
      }
    };

    const nest = new SvgNest(null, svgs, options); // Pass null for binElement
    nest.setBinPolygon(complexBinPolygon); // Use the new method

    const resultSvgs = await nest.start();

    if (!resultSvgs || resultSvgs.length === 0) {
        throw new Error("No nested SVG sheets were generated.");
    }

    // Create a batch on the backend to link these orders
    const orderIdsToBatch = Array.from(new Set(checkedCheckboxes.map(cb => cb.dataset.orderId || cb.value)));
    let batchId = Math.floor(100000 + Math.random() * 900000).toString(); // Fallback if API fails

    try {
      const res = await fetchWithAuth(`${serverUrl}/api/admin/batches`, {
        method: "POST",
        body: JSON.stringify({ orderIds: orderIdsToBatch, status: "PRINTING" }),
      });
      if (res && res.batch && res.batch.batchId) {
        batchId = res.batch.batchId;
      }
    } catch (e) {
      console.error("Failed to create batch on backend, falling back to local ID.", e);
    }

    window.currentCutFileId = batchId; // Save for download button
    window.nestedSvgs = [];
    ui.nestedSvgContainer.innerHTML = '';

    for (let sheetIndex = 0; sheetIndex < resultSvgs.length; sheetIndex++) {
        const resultSvg = resultSvgs[sheetIndex];
        const trackingCode = `${batchId}-${sheetIndex + 1}~`;

        // 4. Inject Printing Marks & QR Codes into SVG
        const domParser = new DOMParser();
        const svgDoc = domParser.parseFromString(resultSvg, "image/svg+xml");
        const rootSvg = svgDoc.documentElement;

        // Auto-shrink length for roll media
        if (isRollMedia) {
            let maxPlacedY = 0;
            const groups = svgDoc.querySelectorAll('.nest-group');
            groups.forEach(group => {
                const transform = group.getAttribute('transform') || '';
                const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                let y = 0;
                if (match) {
                    y = parseFloat(match[2]);
                }
                const img = group.querySelector('image');
                const h = img ? parseFloat(img.getAttribute('height')) : 0;
                if (y + h > maxPlacedY) {
                    maxPlacedY = y + h;
                }
            });
            // Bottom margin and extra padding for fiducials so we don't clip them
            binHeight = maxPlacedY + marginBottom + 100; 
        }

        // Force the SVG to be the size of the bin so fiducials and QRs aren't clipped
        rootSvg.setAttribute("width", String(binWidth));
        rootSvg.setAttribute("height", String(binHeight));
        rootSvg.setAttribute("viewBox", `0 0 ${binWidth} ${binHeight}`);

        const addPrintingMarks = document.getElementById("addPrintingMarks")?.checked || false;

        if (addPrintingMarks) {
            const markShape =
            document.getElementById("alignmentMarkShape").value || "circle";

            // Helper to create alignment mark
            const createMark = (cx, cy) => {
            if (markShape === "square") {
                const rect = svgDoc.createElementNS(
                "http://www.w3.org/2000/svg",
                "rect",
                );
                rect.setAttribute("x", String(cx - 12));
                rect.setAttribute("y", String(cy - 12));
                rect.setAttribute("width", "24");
                rect.setAttribute("height", "24");
                rect.setAttribute("fill", "black");
                return rect;
            } else {
                const circle = svgDoc.createElementNS(
                "http://www.w3.org/2000/svg",
                "circle",
                );
                circle.setAttribute("cx", String(cx));
                circle.setAttribute("cy", String(cy));
                circle.setAttribute("r", "12");
                circle.setAttribute("fill", "black");
                return circle;
            }
            };

            // Add 4 corner marks
            // Top-Left
            rootSvg.appendChild(createMark(60, 60));
            // Top-Right
            rootSvg.appendChild(createMark(binWidth - 60, 60));
            // Bottom-Left
            rootSvg.appendChild(createMark(60, binHeight - 60));
            // Bottom-Right
            rootSvg.appendChild(createMark(binWidth - 60, binHeight - 60));

            if (window.QRCode) {
            try {
                const qrCanvas = document.createElement("canvas");
                await QRCode.toCanvas(qrCanvas, trackingCode, {
                width: 80,
                margin: 1,
                });
                const qrDataUri = qrCanvas.toDataURL("image/png");

                // Helper to add QR and label
                const addQR = (qrX, qrY, textX, textY, textAnchor = "start") => {
                const qrImg = svgDoc.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "image",
                );
                qrImg.setAttribute("href", qrDataUri);
                qrImg.setAttribute("x", String(qrX));
                qrImg.setAttribute("y", String(qrY));
                qrImg.setAttribute("width", "80");
                qrImg.setAttribute("height", "80");

                const textNode = svgDoc.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "text",
                );
                textNode.setAttribute("x", String(textX));
                textNode.setAttribute("y", String(textY));
                textNode.setAttribute("font-family", "sans-serif");
                textNode.setAttribute("font-size", "14");
                textNode.setAttribute("font-weight", "bold");
                textNode.setAttribute("fill", "black");
                textNode.setAttribute("text-anchor", textAnchor);
                textNode.textContent = trackingCode;

                rootSvg.appendChild(qrImg);
                rootSvg.appendChild(textNode);
                };

                // Top-Left: Fiducial cx=60, cy=60. QR x=90, y=20. Text x=185, y=65 ("start").
                addQR(90, 20, 185, 65, "start");
                
                // Bottom-Right: Fiducial cx=binWidth-60, cy=binHeight-60. QR x=binWidth-170, y=binHeight-100. Text x=binWidth-185, y=binHeight-55 ("end").
                addQR(binWidth - 170, binHeight - 100, binWidth - 185, binHeight - 55, "end");
            } catch (qrErr) {
                console.error("Failed to inject QR code into SVG", qrErr);
            }
            }
        }

        // Serialize back to string
        let finalSvg = new XMLSerializer().serializeToString(svgDoc);

        // 5. Display result
        const sanitizedSvg = DOMPurify.sanitize(finalSvg, {
          USE_PROFILES: { svg: true },
          ADD_TAGS: ['image'],
          ADD_ATTR: ['href', 'xlink:href', 'class'],
          ADD_DATA_URI_TAGS: ['image']
        });
        
        window.nestedSvgs.push(sanitizedSvg);

        const sheetWrapper = document.createElement("div");
        sheetWrapper.className = "mb-8";
        sheetWrapper.innerHTML = `
            <h3 class="text-lg font-bold mb-2">Sheet ${sheetIndex + 1}</h3>
            ${sanitizedSvg}
        `;
        ui.nestedSvgContainer.appendChild(sheetWrapper);
    }
    
    showSuccessToast(`Nesting complete. Generated ${resultSvgs.length} sheet(s).`);
  } catch (error) {
    showErrorToast(`Nesting failed: ${error.message}`);
    console.error(error);
  } finally {
    setButtonLoading(btn, false);
  }
}

function handleDownloadCutFile() {
  if (!window.nestedSvgs || window.nestedSvgs.length === 0) {
    showErrorToast("No nested SVG sheets to generate a cut file from.");
    return;
  }

  const cutSettings = getCutSettings();
  window.nestedSvgs.forEach((nestedSvg, index) => {
      const cutFileString = generateCutFile(nestedSvg, cutSettings);
      const blob = new Blob([cutFileString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      // Use the generated ID or fallback to 'cut-file'
      const baseName = window.currentCutFileId ? window.currentCutFileId : "cut-file";
      a.download = `${baseName}-sheet${index + 1}.svg`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  });
}

function handleDownloadCutFilePlt() {
  if (!window.nestedSvgs || window.nestedSvgs.length === 0) {
    showErrorToast("No nested SVG sheets to generate a cut file from.");
    return;
  }

  const cutOptions = {
    mediaType: document.getElementById("mediaType")?.value || "vinyl",
    thickness: parseFloat(document.getElementById("mediaThickness")?.value) || 0.1,
    cutPressure: parseInt(document.getElementById("cutPressure")?.value) || 10,
    cutType: document.getElementById("cutType")?.value || "normal_cut"
  };

  window.nestedSvgs.forEach((nestedSvg, index) => {
      const pltFileString = generatePltFile(nestedSvg, cutOptions);
      const blob = new Blob([pltFileString], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const baseName = window.currentCutFileId ? window.currentCutFileId : "cut-file";
      a.download = `${baseName}-sheet${index + 1}.plt`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  });
}

function handleDownloadCutFileXml() {
  if (!window.nestedSvgs || window.nestedSvgs.length === 0) {
    showErrorToast("No nested SVG sheets to generate an XML cut file from.");
    return;
  }

  const cutSettings = getCutSettings();
  window.nestedSvgs.forEach((nestedSvg, index) => {
    const cutFileString = generateCutFile(nestedSvg, cutSettings);
    const blob = new Blob([cutFileString], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const baseName = window.currentCutFileId ? window.currentCutFileId : "cut-file";
    a.download = `${baseName}-sheet${index + 1}.xml`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  showSuccessToast("XML cut file(s) downloaded.");
}

// --- Cut Line & Layer Settings ---
export const DEFAULT_CUT_SETTINGS = {
  kissCutLayerName: "Kiss-Cut",
  kissCutColor: "#00FFFF",
  edgeCutLayerName: "Die-Cut",
  edgeCutColor: "#FF0000",
};

export function getCutSettings() {
  let settings = { ...DEFAULT_CUT_SETTINGS };

  // Fallback to DOM input values if present
  const kissLayer = document.getElementById("kissCutLayerName") || document.getElementById("settings-kiss-cut-layer");
  const kissColor = document.getElementById("kissCutColor") || document.getElementById("settings-kiss-cut-color");
  const edgeLayer = document.getElementById("edgeCutLayerName") || document.getElementById("settings-edge-cut-layer");
  const edgeColor = document.getElementById("edgeCutColor") || document.getElementById("settings-edge-cut-color");

  if (kissLayer?.value) settings.kissCutLayerName = kissLayer.value.trim();
  if (kissColor?.value) settings.kissCutColor = kissColor.value.trim();
  if (edgeLayer?.value) settings.edgeCutLayerName = edgeLayer.value.trim();
  if (edgeColor?.value) settings.edgeCutColor = edgeColor.value.trim();

  // Saved localStorage settings take precedence over static HTML defaults
  try {
    const saved = localStorage.getItem("splotchCutSettings");
    if (saved && typeof saved === "string" && saved.trim().startsWith("{")) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        settings = { ...settings, ...parsed };
      }
    }
  } catch (err) {
    // Ignore invalid JSON in localStorage
  }

  return settings;
}

export function saveCutSettings(newSettings) {
  const current = getCutSettings();
  const updated = { ...current, ...newSettings };
  try {
    localStorage.setItem("splotchCutSettings", JSON.stringify(updated));
  } catch (err) {
    console.warn("[PRINTSHOP] Failed to save cut settings to localStorage:", err);
  }
  syncCutSettingsUI(updated);
  return updated;
}

export function syncCutSettingsUI(settings) {
  const s = settings || getCutSettings();

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
  };

  // Sidebar controls
  setVal("kissCutLayerName", s.kissCutLayerName);
  setVal("kissCutColor", s.kissCutColor);
  setVal("kissCutColorPicker", s.kissCutColor);
  setVal("edgeCutLayerName", s.edgeCutLayerName);
  setVal("edgeCutColor", s.edgeCutColor);
  setVal("edgeCutColorPicker", s.edgeCutColor);

  // Settings View controls
  setVal("settings-kiss-cut-layer", s.kissCutLayerName);
  setVal("settings-kiss-cut-color", s.kissCutColor);
  setVal("settings-kiss-cut-color-picker", s.kissCutColor);
  setVal("settings-edge-cut-layer", s.edgeCutLayerName);
  setVal("settings-edge-cut-color", s.edgeCutColor);
  setVal("settings-edge-cut-color-picker", s.edgeCutColor);

  // Color Indicator Dots
  const kissDot = document.getElementById("settings-kiss-cut-indicator");
  if (kissDot) kissDot.style.backgroundColor = s.kissCutColor;
  const edgeDot = document.getElementById("settings-edge-cut-indicator");
  if (edgeDot) edgeDot.style.backgroundColor = s.edgeCutColor;
}

export function initCutSettingsListeners() {
  syncCutSettingsUI();

  // Helper for 2-way hex & color picker binding with storage update
  const bindColorInputs = (textId, pickerId, settingKey, dotId) => {
    const textEl = document.getElementById(textId);
    const pickerEl = document.getElementById(pickerId);
    const dotEl = dotId ? document.getElementById(dotId) : null;

    if (pickerEl) {
      pickerEl.addEventListener("input", (e) => {
        const val = e.target.value.toUpperCase();
        if (textEl) textEl.value = val;
        if (dotEl) dotEl.style.backgroundColor = val;
        saveCutSettings({ [settingKey]: val });
      });
    }

    if (textEl) {
      textEl.addEventListener("input", (e) => {
        let val = e.target.value.trim().toUpperCase();
        if (!val.startsWith("#") && /^[0-9A-F]{6}$/i.test(val)) {
          val = "#" + val;
        }
        if (/^#[0-9A-F]{6}$/i.test(val)) {
          if (pickerEl) pickerEl.value = val;
          if (dotEl) dotEl.style.backgroundColor = val;
          saveCutSettings({ [settingKey]: val });
        }
      });
    }
  };

  // Helper for layer name inputs
  const bindLayerInput = (id, settingKey) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", (e) => {
        const val = e.target.value.trim();
        if (val) {
          saveCutSettings({ [settingKey]: val });
        }
      });
    }
  };

  // Bind Sidebar controls
  bindColorInputs("kissCutColor", "kissCutColorPicker", "kissCutColor", "settings-kiss-cut-indicator");
  bindColorInputs("edgeCutColor", "edgeCutColorPicker", "edgeCutColor", "settings-edge-cut-indicator");
  bindLayerInput("kissCutLayerName", "kissCutLayerName");
  bindLayerInput("edgeCutLayerName", "edgeCutLayerName");

  // Bind Settings View controls
  bindColorInputs("settings-kiss-cut-color", "settings-kiss-cut-color-picker", "kissCutColor", "settings-kiss-cut-indicator");
  bindColorInputs("settings-edge-cut-color", "settings-edge-cut-color-picker", "edgeCutColor", "settings-edge-cut-indicator");
  bindLayerInput("settings-kiss-cut-layer", "kissCutLayerName");
  bindLayerInput("settings-edge-cut-layer", "edgeCutLayerName");

  // Presets
  document.getElementById("preset-roland-btn")?.addEventListener("click", () => {
    const preset = {
      kissCutLayerName: "CutContour",
      kissCutColor: "#FF00FF",
      edgeCutLayerName: "PerfCutContour",
      edgeCutColor: "#00FFFF",
    };
    saveCutSettings(preset);
    showSuccessToast("Roland VersaWorks cut preset applied.");
  });

  document.getElementById("preset-vinylmaster-btn")?.addEventListener("click", () => {
    const preset = {
      kissCutLayerName: "Kiss-Cut",
      kissCutColor: "#00FFFF",
      edgeCutLayerName: "Die-Cut",
      edgeCutColor: "#FF0000",
    };
    saveCutSettings(preset);
    showSuccessToast("VinylMaster cut preset applied.");
  });

  document.getElementById("preset-standard-btn")?.addEventListener("click", () => {
    saveCutSettings(DEFAULT_CUT_SETTINGS);
    showSuccessToast("Default cut preset applied.");
  });

  document.getElementById("save-cut-settings-btn")?.addEventListener("click", () => {
    const kissLayer = document.getElementById("settings-kiss-cut-layer")?.value.trim() || "Kiss-Cut";
    const kissColor = document.getElementById("settings-kiss-cut-color")?.value.trim() || "#00FFFF";
    const edgeLayer = document.getElementById("settings-edge-cut-layer")?.value.trim() || "Die-Cut";
    const edgeColor = document.getElementById("settings-edge-cut-color")?.value.trim() || "#FF0000";

    saveCutSettings({
      kissCutLayerName: kissLayer,
      kissCutColor: kissColor,
      edgeCutLayerName: edgeLayer,
      edgeCutColor: edgeColor,
    });
    showSuccessToast("Cut Line & Layer settings saved.");
  });
}

export function prepareVectorPrintCutSvg(svgElement, layerNameOrConfig = "CutContour", cutColor = "#FF00FF") {
  let width = parseFloat(svgElement.getAttribute("width"));
  let height = parseFloat(svgElement.getAttribute("height"));

  if (isNaN(width) || isNaN(height)) {
    const viewBox = svgElement.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/);
      if (parts.length === 4) {
        width = parseFloat(parts[2]);
        height = parseFloat(parts[3]);
      }
    }
  }

  const vectorSvgElement = svgElement.cloneNode(true);
  if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
    vectorSvgElement.setAttribute("width", String(width));
    vectorSvgElement.setAttribute("height", String(height));
  }

  let kissCutLayerName = "Kiss-Cut";
  let kissCutColor = "#00FFFF";
  let edgeCutLayerName = "Die-Cut";
  let edgeCutColor = "#FF0000";

  if (typeof layerNameOrConfig === "object" && layerNameOrConfig !== null) {
    kissCutLayerName = layerNameOrConfig.kissCutLayerName || "Kiss-Cut";
    kissCutColor = layerNameOrConfig.kissCutColor || "#00FFFF";
    edgeCutLayerName = layerNameOrConfig.edgeCutLayerName || "Die-Cut";
    edgeCutColor = layerNameOrConfig.edgeCutColor || "#FF0000";
  } else if (typeof layerNameOrConfig === "string") {
    // Backwards compatible single layer / single color call
    kissCutLayerName = layerNameOrConfig;
    edgeCutLayerName = layerNameOrConfig;
    kissCutColor = cutColor || "#FF00FF";
    edgeCutColor = cutColor || "#FF00FF";
  }

  const classifyCutElement = (el) => {
    const id = (el.getAttribute("id") || "").toLowerCase();
    const parentId = (el.parentElement?.getAttribute("id") || "").toLowerCase();
    const cls = (el.getAttribute("class") || "").toLowerCase();
    if (
      id.includes("die") ||
      id.includes("perf") ||
      id.includes("edge") ||
      parentId.includes("die") ||
      parentId.includes("perf") ||
      parentId.includes("edge") ||
      cls.includes("die") ||
      cls.includes("perf") ||
      cls.includes("edge")
    ) {
      return "edge";
    }
    if (id.includes("kiss") || parentId.includes("kiss") || cls.includes("kiss")) {
      return "kiss";
    }
    const cutTypeSelect = document.getElementById("cutType");
    if (cutTypeSelect?.value === "normal_cut") {
      return "edge";
    }
    return "kiss";
  };

  const styleCutElement = (el, strokeColor) => {
    const paths =
      el.tagName.toLowerCase() === "g"
        ? el.querySelectorAll("path, polygon, polyline, rect, circle, ellipse")
        : [el];

    paths.forEach((p) => {
      p.setAttribute("stroke", strokeColor);
      p.setAttribute("stroke-width", "1");
      p.setAttribute("fill", "none");
      p.removeAttribute("class");
    });
  };

  const isCutCandidate = (el) => {
    if (el.tagName.toLowerCase() === "image") return false;
    const parentId = (el.parentElement?.getAttribute("id") || "").toLowerCase();
    if (
      parentId.includes("cmyk") ||
      parentId.includes("white") ||
      parentId.includes("inlay") ||
      parentId.includes("clear")
    ) {
      return false;
    }
    return true;
  };

  const nestGroups = vectorSvgElement.querySelectorAll(".nest-group");

  if (nestGroups.length > 0) {
    if (kissCutLayerName === edgeCutLayerName) {
      // Coalesced into a single layer
      const cutLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      cutLayer.setAttribute("id", kissCutLayerName);
      cutLayer.setAttribute("data-name", kissCutLayerName);

      nestGroups.forEach((nestGroup) => {
        let cutEls = Array.from(
          nestGroup.querySelectorAll(".cut-line-element, [id*='kiss' i], [id*='die' i]"),
        );
        if (cutEls.length === 0) {
          cutEls = Array.from(nestGroup.querySelectorAll("path, polygon, polyline"));
        }
        const validCutEls = cutEls.filter(isCutCandidate);
        const topCutEls = validCutEls.filter(
          (el) => !validCutEls.some((other) => other !== el && other.contains(el)),
        );

        if (topCutEls.length > 0) {
          const cutSubGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
          if (nestGroup.hasAttribute("transform")) {
            cutSubGroup.setAttribute("transform", nestGroup.getAttribute("transform"));
          }
          if (nestGroup.hasAttribute("data-scale")) {
            cutSubGroup.setAttribute("data-scale", nestGroup.getAttribute("data-scale"));
          }

          topCutEls.forEach((el) => {
            const type = classifyCutElement(el);
            const color = type === "edge" ? edgeCutColor : kissCutColor;
            styleCutElement(el, color);
            cutSubGroup.appendChild(el);
          });

          if (cutSubGroup.childNodes.length > 0) {
            cutLayer.appendChild(cutSubGroup);
          }
        }
      });

      if (cutLayer.childNodes.length > 0) {
        vectorSvgElement.appendChild(cutLayer);
      }
    } else {
      // Distinct layers for Kiss Cut and Edge Cut
      const kissCutLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      kissCutLayer.setAttribute("id", kissCutLayerName);
      kissCutLayer.setAttribute("data-name", kissCutLayerName);

      const edgeCutLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      edgeCutLayer.setAttribute("id", edgeCutLayerName);
      edgeCutLayer.setAttribute("data-name", edgeCutLayerName);

      nestGroups.forEach((nestGroup) => {
        let cutEls = Array.from(
          nestGroup.querySelectorAll(".cut-line-element, [id*='kiss' i], [id*='die' i]"),
        );
        if (cutEls.length === 0) {
          cutEls = Array.from(nestGroup.querySelectorAll("path, polygon, polyline"));
        }
        const validCutEls = cutEls.filter(isCutCandidate);
        const topCutEls = validCutEls.filter(
          (el) => !validCutEls.some((other) => other !== el && other.contains(el)),
        );

        const kissEls = [];
        const edgeEls = [];
        topCutEls.forEach((el) => {
          if (classifyCutElement(el) === "edge") {
            edgeEls.push(el);
          } else {
            kissEls.push(el);
          }
        });

        if (kissEls.length > 0) {
          const kissSubGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
          if (nestGroup.hasAttribute("transform")) {
            kissSubGroup.setAttribute("transform", nestGroup.getAttribute("transform"));
          }
          if (nestGroup.hasAttribute("data-scale")) {
            kissSubGroup.setAttribute("data-scale", nestGroup.getAttribute("data-scale"));
          }
          kissEls.forEach((el) => {
            styleCutElement(el, kissCutColor);
            kissSubGroup.appendChild(el);
          });
          if (kissSubGroup.childNodes.length > 0) {
            kissCutLayer.appendChild(kissSubGroup);
          }
        }

        if (edgeEls.length > 0) {
          const edgeSubGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
          if (nestGroup.hasAttribute("transform")) {
            edgeSubGroup.setAttribute("transform", nestGroup.getAttribute("transform"));
          }
          if (nestGroup.hasAttribute("data-scale")) {
            edgeSubGroup.setAttribute("data-scale", nestGroup.getAttribute("data-scale"));
          }
          edgeEls.forEach((el) => {
            styleCutElement(el, edgeCutColor);
            edgeSubGroup.appendChild(el);
          });
          if (edgeSubGroup.childNodes.length > 0) {
            edgeCutLayer.appendChild(edgeSubGroup);
          }
        }
      });

      if (kissCutLayer.childNodes.length > 0) {
        vectorSvgElement.appendChild(kissCutLayer);
      }
      if (edgeCutLayer.childNodes.length > 0) {
        vectorSvgElement.appendChild(edgeCutLayer);
      }
    }
  } else {
    // Flat un-nested SVG fallback
    const cutEls = Array.from(
      vectorSvgElement.querySelectorAll(".cut-line-element, path, polygon, polyline"),
    );
    const validCutEls = cutEls.filter(isCutCandidate);
    const topCutEls = validCutEls.filter(
      (el) => !validCutEls.some((other) => other !== el && other.contains(el)),
    );

    if (kissCutLayerName === edgeCutLayerName) {
      const cutLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      cutLayer.setAttribute("id", kissCutLayerName);
      cutLayer.setAttribute("data-name", kissCutLayerName);

      topCutEls.forEach((el) => {
        const type = classifyCutElement(el);
        const color = type === "edge" ? edgeCutColor : kissCutColor;
        styleCutElement(el, color);
        cutLayer.appendChild(el);
      });

      if (cutLayer.childNodes.length > 0) {
        vectorSvgElement.appendChild(cutLayer);
      }
    } else {
      const kissCutLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      kissCutLayer.setAttribute("id", kissCutLayerName);
      kissCutLayer.setAttribute("data-name", kissCutLayerName);

      const edgeCutLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      edgeCutLayer.setAttribute("id", edgeCutLayerName);
      edgeCutLayer.setAttribute("data-name", edgeCutLayerName);

      topCutEls.forEach((el) => {
        const type = classifyCutElement(el);
        if (type === "edge") {
          styleCutElement(el, edgeCutColor);
          edgeCutLayer.appendChild(el);
        } else {
          styleCutElement(el, kissCutColor);
          kissCutLayer.appendChild(el);
        }
      });

      if (kissCutLayer.childNodes.length > 0) {
        vectorSvgElement.appendChild(kissCutLayer);
      }
      if (edgeCutLayer.childNodes.length > 0) {
        vectorSvgElement.appendChild(edgeCutLayer);
      }
    }
  }

  return vectorSvgElement;
}

async function handleDownloadPdf() {
  if (!window.nestedSvgs || window.nestedSvgs.length === 0) {
    showErrorToast("No nested SVG sheets to generate a PDF from.");
    return;
  }

  const btn = ui.downloadPdfBtn || document.getElementById("downloadPdfBtn");
  if (btn) setButtonLoading(btn, true, "Generating PDF...");

  try {
    const baseName = window.currentCutFileId ? window.currentCutFileId : "nested-stickers";
    const cutSettings = getCutSettings();

    let pdfDoc = null;

    for (let i = 0; i < window.nestedSvgs.length; i++) {
      const svgElement = new DOMParser().parseFromString(
        window.nestedSvgs[i],
        "image/svg+xml",
      ).documentElement;

      let width = parseFloat(svgElement.getAttribute("width"));
      let height = parseFloat(svgElement.getAttribute("height"));

      if (isNaN(width) || isNaN(height)) {
        const viewBox = svgElement.getAttribute("viewBox");
        if (viewBox) {
          const parts = viewBox.split(/[\s,]+/);
          if (parts.length === 4) {
            width = parseFloat(parts[2]);
            height = parseFloat(parts[3]);
          }
        }
      }

      if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        throw new Error(`Invalid SVG dimensions for sheet ${i + 1}`);
      }

      const vectorSvgElement = prepareVectorPrintCutSvg(svgElement, cutSettings);

      const orientation = width > height ? "landscape" : "portrait";

      if (i === 0) {
        pdfDoc = new jsPDF({
          unit: "px",
          format: [width, height],
          orientation,
        });
      } else {
        pdfDoc.addPage([width, height], orientation);
      }

      await pdfDoc.svg(vectorSvgElement, { x: 0, y: 0, width, height });
    }

    if (pdfDoc) {
      const fileName = window.nestedSvgs.length > 1
        ? `${baseName}-all-sheets.pdf`
        : `${baseName}-sheet1.pdf`;
      pdfDoc.save(fileName);
      showSuccessToast("PDF cut/print file downloaded successfully.");
    }
  } catch (error) {
    showErrorToast(`PDF generation failed: ${error.message}`);
    console.error("[PRINTSHOP] PDF generation error:", error);
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

async function handleExportPdf() {
  if (!window.nestedSvgs || window.nestedSvgs.length === 0) {
    showErrorToast("No nested SVG sheets to export.");
    return;
  }

  const btn = ui.exportPdfBtn || document.getElementById("exportPdfBtn");
  if (btn) setButtonLoading(btn, true, "Exporting Package...");

  try {
    let doc = null;
    const zip = new JSZip();
    const baseName = window.currentCutFileId ? window.currentCutFileId : "nested-stickers";

    for (let i = 0; i < window.nestedSvgs.length; i++) {
        const svgElement = new DOMParser().parseFromString(
          window.nestedSvgs[i],
          "image/svg+xml",
        ).documentElement;
        let width = parseFloat(svgElement.getAttribute("width"));
        let height = parseFloat(svgElement.getAttribute("height"));

        if (isNaN(width) || isNaN(height)) {
          const viewBox = svgElement.getAttribute("viewBox");
          if (viewBox) {
            const parts = viewBox.split(/[\s,]+/);
            if (parts.length === 4) {
              width = parseFloat(parts[2]);
              height = parseFloat(parts[3]);
            }
          }
        }

        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
          showErrorToast("Invalid SVG dimensions for PDF export on sheet " + (i+1));
          return;
        }

        // Try rasterizing image layer for the flattened PrintOnly PDF
        try {
          const rasterSvg = svgElement.cloneNode(true);
          rasterSvg.querySelectorAll('path, polygon, polyline, line').forEach(el => el.remove());
          const scale = 300 / 96;
          const targetWidth = Math.round(width * scale);
          const targetHeight = Math.round(height * scale);
          rasterSvg.setAttribute("width", String(targetWidth));
          rasterSvg.setAttribute("height", String(targetHeight));

          const svgString = new XMLSerializer().serializeToString(rasterSvg);
          const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(svgBlob);

          const img = new Image();
          await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = () => reject(new Error("Failed to load SVG into Image element"));
              img.src = url;
          });

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          URL.revokeObjectURL(url);

          const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);

          if (i === 0) {
              doc = new jsPDF({
                unit: "px",
                format: [width, height],
              });
          } else {
              doc.addPage([width, height]);
          }

          doc.addImage(jpegDataUrl, 'JPEG', 0, 0, width, height);

          const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          const sheetSuffix = window.nestedSvgs.length > 1 ? `-sheet${i + 1}` : '';
          if (pngBlob) {
            zip.file(`${baseName}${sheetSuffix}-300dpi.png`, pngBlob);
          }
        } catch (rasterErr) {
          console.warn("[PRINTSHOP] Could not rasterize flattened print canvas, proceeding with vector PDF:", rasterErr);
        }

        // Generate Vector Print & Cut PDF using svg2pdf
        const cutSettings = getCutSettings();
        const vectorSvgElement = prepareVectorPrintCutSvg(svgElement, cutSettings);

        const vectorDoc = new jsPDF({
            unit: "px",
            format: [width, height],
        });

        await vectorDoc.svg(vectorSvgElement, { x: 0, y: 0, width: width, height: height });

        const sheetSuffix = window.nestedSvgs.length > 1 ? `-sheet${i + 1}` : '';
        const vectorPdfBlob = vectorDoc.output('blob');
        zip.file(`${baseName}${sheetSuffix}-VinylMaster-PrintCut.pdf`, vectorPdfBlob);
    }

    if (doc) {
      const pdfBlob = doc.output('blob');
      zip.file(`${baseName}-PrintOnly.pdf`, pdfBlob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement("a");
    const zipUrl = URL.createObjectURL(zipBlob);
    a.href = zipUrl;
    a.download = `${baseName}-print-package.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(zipUrl);

    showSuccessToast("Print package exported successfully.");
  } catch (error) {
    showErrorToast(`Print Package Export Failed: ${error.message}`);
    console.error(error);
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

// --- Odoo Configuration Logic ---
async function loadOdooConfig() {
  showLoadingIndicator();
  try {
    const config = await fetchWithAuth(`${serverUrl}/api/admin/odoo/config`);

    document.getElementById("odoo-url").value = config.url || "";
    document.getElementById("odoo-db").value = config.db || "";
    document.getElementById("odoo-username").value = config.username || "";
    document.getElementById("odoo-password").value = config.password || "";
    document.getElementById("odoo-default-task").value =
      config.defaults?.project_task_id || "";
    document.getElementById("odoo-picking-type").value =
      config.defaults?.picking_type_id || "";

    await renderMaterialMapping(config.mappings || {});
  } catch (error) {
    showErrorToast(`Failed to load Odoo config: ${error.message}`);
  } finally {
    hideLoadingIndicator();
  }
}

async function renderMaterialMapping(currentMappings) {
  try {
    const pricing = await fetch(`${serverUrl}/api/pricing-info`).then((res) =>
      res.json(),
    );
    const tbody = document.getElementById("material-mapping-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const materials = pricing.materials ? [...pricing.materials] : [];
    materials.push({ id: "ink", name: "Ink Usage (Sq In)" });

    materials.forEach((mat) => {
      const tr = document.createElement("tr");
      const odooId = currentMappings[mat.id] || "";

      tr.innerHTML = `
                <td class="py-2 px-4 border">${escapeHtml(mat.name)} (${escapeHtml(mat.id)})</td>
                <td class="py-2 px-4 border">
                    <input type="number" class="w-full p-1 border rounded mapping-input" data-key="${mat.id}" value="${escapeHtml(odooId)}">
                </td>
            `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error("Failed to load pricing info for mapping:", error);
  }
}

// --- Printshop Config ---
let printshops = [];

async function loadPrintshops() {
  try {
    if (!currentPricingConfig || !currentPricingConfig.materials) {
        currentPricingConfig = await fetchWithAuth(`${serverUrl}/api/pricing-info`);
    }
    printshops = await fetchWithAuth(`${serverUrl}/api/admin/printshops`);
    populatePrintshopSelectors();
  } catch (err) {
    console.error("Failed to load printshops", err);
  }
}

function populatePrintshopSelectors() {
  const activeSelector = document.getElementById("active-printshop");
  const configSelector = document.getElementById("printshop-selector");
  if (!activeSelector || !configSelector) return;

  const currentActive = activeSelector.value;
  const currentConfig = configSelector.value;

  activeSelector.innerHTML = '<option value="">All Printshops</option>';
  configSelector.innerHTML = '<option value="new">+ Create New Printshop</option>';

  printshops.forEach(shop => {
    const optActive = document.createElement("option");
    optActive.value = shop.id;
    optActive.textContent = shop.name;
    activeSelector.appendChild(optActive);

    const optConfig = document.createElement("option");
    optConfig.value = shop.id;
    optConfig.textContent = shop.name;
    configSelector.appendChild(optConfig);
  });

  activeSelector.value = currentActive || "";
  if (currentConfig && currentConfig !== "new" && printshops.find(s => s.id === currentConfig)) {
      configSelector.value = currentConfig;
      loadPrintshopForm(currentConfig);
  } else if (printshops.length > 0) {
      configSelector.value = printshops[0].id;
      loadPrintshopForm(printshops[0].id);
  } else {
      configSelector.value = "new";
      resetPrintshopForm();
  }
}

function resetPrintshopForm() {
  document.getElementById("printshop-id").value = "";
  document.getElementById("printshop-name").value = "";
  document.getElementById("printshop-address").value = "";
  document.getElementById("printshop-users").value = "";
  document.getElementById("printshop-machines-list").innerHTML = "";
  document.getElementById("delete-printshop-btn").classList.add("hidden");
}

function loadPrintshopForm(id) {
  const shop = printshops.find(s => s.id === id);
  if (!shop) return resetPrintshopForm();

  document.getElementById("printshop-id").value = shop.id;
  document.getElementById("printshop-name").value = shop.name || "";
  document.getElementById("printshop-address").value = shop.address || "";
  document.getElementById("printshop-users").value = (shop.assigned_users || []).join(", ");
  
  const machinesList = document.getElementById("printshop-machines-list");
  machinesList.innerHTML = "";
  if (shop.machines && Array.isArray(shop.machines)) {
      shop.machines.forEach(m => addMachineCard(m));
  }
  
  document.getElementById("delete-printshop-btn").classList.remove("hidden");
}

function addMachineCard(machineData = null) {
    const template = document.getElementById("machine-template");
    const container = document.getElementById("printshop-machines-list");
    const clone = template.content.cloneNode(true);
    
    const card = clone.querySelector(".machine-card");
    // Generate unique ID for this card
    const cardId = 'machine-' + Math.random().toString(36).substr(2, 9);
    card.dataset.id = cardId;
    
    // Inject pricing checkboxes dynamically
    if (currentPricingConfig) {
        const matContainer = card.querySelector(".machine-materials-container");
        (currentPricingConfig.materials || []).forEach(mat => {
            matContainer.innerHTML += `<label class="block"><input type="checkbox" class="machine-mat-cb mr-1" value="${mat.id}"> ${mat.name}</label>`;
        });
        
        const layContainer = card.querySelector(".machine-layers-container");
        (currentPricingConfig.layers || []).forEach(lay => {
            layContainer.innerHTML += `<label class="block"><input type="checkbox" class="machine-lay-cb mr-1" value="${lay.id}"> ${lay.name}</label>`;
        });
        
        const resContainer = card.querySelector(".machine-resolutions-container");
        (currentPricingConfig.resolutions || []).forEach(res => {
            resContainer.innerHTML += `<label class="block"><input type="checkbox" class="machine-res-cb mr-1" value="${res.id}"> ${res.name}</label>`;
        });
        
        const cxSelect = card.querySelector(".machine-complexity-select");
        if (currentPricingConfig.complexity && currentPricingConfig.complexity.tiers) {
            currentPricingConfig.complexity.tiers.forEach(tier => {
                cxSelect.innerHTML += `<option value="${tier.thresholdInches}">Up to ${tier.thresholdInches} inches</option>`;
            });
        }
    }
    
    // Bind remove button
    card.querySelector(".remove-machine-btn").addEventListener("click", () => card.remove());
    
    // Bind add discount button
    card.querySelector(".add-discount-btn").addEventListener("click", () => {
        const list = card.querySelector(".machine-discounts-list");
        const div = document.createElement("div");
        div.className = "flex items-center space-x-2 discount-tier";
        div.innerHTML = `
            <span>Qty:</span>
            <input type="number" class="discount-qty p-1 border rounded w-20" min="1" placeholder="e.g. 1000">
            <span>Discount:</span>
            <input type="number" step="0.01" class="discount-val p-1 border rounded w-20" placeholder="e.g. 0.2">
            <button type="button" class="text-red-500 font-bold ml-2" onclick="this.parentElement.remove()">X</button>
        `;
        list.appendChild(div);
    });
    
    // Populate data if editing
    if (machineData) {
        if(machineData.id) card.dataset.machineId = machineData.id;
        card.querySelector(".machine-type").value = machineData.type || "printer";
        card.querySelector(".machine-model").value = machineData.modelNumber || "";
        card.querySelector(".machine-serial").value = machineData.serialNumber || "";
        card.querySelector(".machine-status").value = machineData.status || "working";
        card.querySelector(".machine-complexity-select").value = machineData.maxCutlineTier || "";
        
        const media = machineData.supportedMedia || [];
        card.querySelectorAll(".machine-media-type").forEach(cb => cb.checked = media.includes(cb.value));
        
        const mats = machineData.supportedMaterials || [];
        card.querySelectorAll(".machine-mat-cb").forEach(cb => cb.checked = mats.includes(cb.value));
        
        const lays = machineData.supportedLayers || [];
        card.querySelectorAll(".machine-lay-cb").forEach(cb => cb.checked = lays.includes(cb.value));
        
        const res = machineData.supportedResolutions || [];
        card.querySelectorAll(".machine-res-cb").forEach(cb => cb.checked = res.includes(cb.value));
        
        if (machineData.bulkDiscounts) {
            const list = card.querySelector(".machine-discounts-list");
            machineData.bulkDiscounts.forEach(d => {
                const div = document.createElement("div");
                div.className = "flex items-center space-x-2 discount-tier";
                div.innerHTML = `
                    <span>Qty:</span>
                    <input type="number" class="discount-qty p-1 border rounded w-20" value="${d.quantity}">
                    <span>Discount:</span>
                    <input type="number" step="0.01" class="discount-val p-1 border rounded w-20" value="${d.discount}">
                    <button type="button" class="text-red-500 font-bold ml-2" onclick="this.parentElement.remove()">X</button>
                `;
                list.appendChild(div);
            });
        }
    }
    
    container.appendChild(card);
}

document.getElementById("add-machine-btn")?.addEventListener("click", () => addMachineCard());

async function savePrintshopConfig(e) {
  e.preventDefault();
  const btn = document.getElementById("save-printshop-btn");
  setButtonLoading(btn, true, "Saving...");

  const id = document.getElementById("printshop-id").value;
  const name = document.getElementById("printshop-name").value;
  const address = document.getElementById("printshop-address").value;
  const usersStr = document.getElementById("printshop-users").value;
  
  const assigned_users = usersStr.split(",").map(s => s.trim()).filter(s => s);
  
  const machines = [];
  document.querySelectorAll(".machine-card").forEach(card => {
      const type = card.querySelector(".machine-type").value;
      const modelNumber = card.querySelector(".machine-model").value;
      const serialNumber = card.querySelector(".machine-serial").value;
      const status = card.querySelector(".machine-status").value;
      const maxCutlineTier = card.querySelector(".machine-complexity-select").value;
      
      const supportedMedia = Array.from(card.querySelectorAll(".machine-media-type:checked")).map(cb => cb.value);
      const supportedMaterials = Array.from(card.querySelectorAll(".machine-mat-cb:checked")).map(cb => cb.value);
      const supportedLayers = Array.from(card.querySelectorAll(".machine-lay-cb:checked")).map(cb => cb.value);
      const supportedResolutions = Array.from(card.querySelectorAll(".machine-res-cb:checked")).map(cb => cb.value);
      
      const bulkDiscounts = [];
      card.querySelectorAll(".discount-tier").forEach(div => {
          const q = parseInt(div.querySelector(".discount-qty").value);
          const v = parseFloat(div.querySelector(".discount-val").value);
          if (!isNaN(q) && !isNaN(v)) bulkDiscounts.push({ quantity: q, discount: v });
      });
      
      machines.push({
          id: card.dataset.machineId || undefined,
          type,
          modelNumber,
          serialNumber,
          status,
          supportedMedia,
          supportedMaterials,
          supportedLayers,
          supportedResolutions,
          maxCutlineTier: maxCutlineTier || undefined,
          bulkDiscounts
      });
  });
  
  const shop = {
      id: id || undefined,
      name,
      address,
      assigned_users,
      machines
  };

  try {
    await fetchWithAuth(`${serverUrl}/api/admin/printshops`, {
      method: "POST",
      body: JSON.stringify(shop),
    });
    showSuccessToast("Printshop saved.");
    await loadPrintshops();
    
    if (!id && printshops.length > 0) {
       document.getElementById("printshop-selector").value = printshops[printshops.length - 1].id;
       loadPrintshopForm(printshops[printshops.length - 1].id);
    }
  } catch (error) {
    showErrorToast(`Failed to save printshop: ${error.message}`);
  } finally {
    setButtonLoading(btn, false, "Save Printshop Configuration");
  }
}


async function deletePrintshop() {
  if (!confirm("Are you sure you want to delete this printshop?")) return;
  const id = document.getElementById("printshop-id").value;
  if (!id) return;
  
  try {
    await fetchWithAuth(`${serverUrl}/api/admin/printshops/${id}`, {
      method: "DELETE"
    });
    showSuccessToast("Printshop deleted.");
    await loadPrintshops();
  } catch (err) {
    showErrorToast(`Failed to delete: ${err.message}`);
  }
}


async function saveOdooConfig(e) {
  e.preventDefault();
  const btn = e.submitter || document.getElementById("save-odoo-config-btn");
  setButtonLoading(btn, true, "Saving...");

  const url = document.getElementById("odoo-url").value;
  const db = document.getElementById("odoo-db").value;
  const username = document.getElementById("odoo-username").value;
  const password = document.getElementById("odoo-password").value;
  const defaultTask = document.getElementById("odoo-default-task").value;
  const pickingType = document.getElementById("odoo-picking-type").value;

  const mappings = {};
  document.querySelectorAll(".mapping-input").forEach((input) => {
    const key = input.dataset.key;
    const val = input.value;
    if (val) mappings[key] = val;
  });

  const defaults = {
    project_task_id: defaultTask ? Number(defaultTask) : null,
    picking_type_id: pickingType ? Number(pickingType) : null,
  };

  try {
    await fetchWithAuth(`${serverUrl}/api/admin/odoo/config`, {
      method: "POST",
      body: JSON.stringify({
        url,
        db,
        username,
        password,
        mappings,
        defaults,
      }),
    });
    showSuccessToast("Odoo configuration saved.");
  } catch (error) {
    showErrorToast(`Failed to save config: ${error.message}`);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function testOdooConnection(e) {
  const btn = e
    ? e.currentTarget || e.target.closest("button")
    : document.getElementById("test-odoo-btn");
  setButtonLoading(btn, true, "Testing...");
  const resultSpan = document.getElementById("test-connection-result");
  resultSpan.textContent = "";
  resultSpan.className = "text-sm font-bold text-gray-500";

  try {
    const result = await fetchWithAuth(`${serverUrl}/api/admin/odoo/test`, {
      method: "POST",
    });
    if (result.success) {
      resultSpan.textContent = `Success! Version: ${JSON.stringify(result.version)}`;
      resultSpan.className = "text-sm font-bold text-green-600";
    } else {
      resultSpan.textContent = `Failed: ${result.error}`;
      resultSpan.className = "text-sm font-bold text-red-600";
    }
  } catch (error) {
    resultSpan.textContent = `Error: ${error.message}`;
    resultSpan.className = "text-sm font-bold text-red-600";
  } finally {
    setButtonLoading(btn, false);
  }
}

// --- Pirate Ship Integration Logic ---
async function loadPirateShipConfig() {
  try {
    const data = await fetchWithAuth(`${serverUrl}/api/admin/integrations/pirateship`);
    if (data && data.success) {
      const storeUrlInput = document.getElementById("pirateship-store-url");
      const keyInput = document.getElementById("pirateship-consumer-key");
      const secretInput = document.getElementById("pirateship-consumer-secret");
      const autoSyncToggle = document.getElementById("pirateship-auto-sync-toggle");
      const statusBadge = document.getElementById("pirateship-sync-status-badge");

      if (storeUrlInput) storeUrlInput.value = data.storeUrl || window.location.origin;
      if (keyInput) keyInput.value = data.consumerKey || "";
      if (secretInput) secretInput.value = data.consumerSecret || "";

      pirateShipAutoSync = data.autoSync !== false;
      if (autoSyncToggle) {
        autoSyncToggle.checked = pirateShipAutoSync;
      }
      if (statusBadge) {
        statusBadge.textContent = `WooCommerce REST API v3 Compatible • Status: ${pirateShipAutoSync ? "Auto-Sync Active" : "Manual Queue Mode"}`;
      }
    }
  } catch (error) {
    console.warn("Failed to load Pirate Ship configuration:", error);
  }
}

function initPirateShipListeners() {
  document.getElementById("copy-pirateship-url-btn")?.addEventListener("click", () => {
    const url = document.getElementById("pirateship-store-url")?.value;
    if (url) {
      navigator.clipboard.writeText(url);
      showSuccessToast("Store URL copied to clipboard!");
    }
  });

  document.getElementById("copy-pirateship-key-btn")?.addEventListener("click", () => {
    const key = document.getElementById("pirateship-consumer-key")?.value;
    if (key) {
      navigator.clipboard.writeText(key);
      showSuccessToast("Consumer Key copied to clipboard!");
    }
  });

  document.getElementById("toggle-pirateship-secret-btn")?.addEventListener("click", () => {
    const secretInput = document.getElementById("pirateship-consumer-secret");
    const toggleBtn = document.getElementById("toggle-pirateship-secret-btn");
    if (secretInput) {
      if (secretInput.type === "password") {
        secretInput.type = "text";
        if (toggleBtn) toggleBtn.textContent = "Hide";
      } else {
        secretInput.type = "password";
        if (toggleBtn) toggleBtn.textContent = "Show";
      }
    }
  });

  document.getElementById("copy-pirateship-secret-btn")?.addEventListener("click", () => {
    const secret = document.getElementById("pirateship-consumer-secret")?.value;
    if (secret) {
      navigator.clipboard.writeText(secret);
      showSuccessToast("Consumer Secret copied to clipboard!");
    }
  });

  document.getElementById("regenerate-pirateship-keys-btn")?.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to regenerate Pirate Ship keys? You will need to update the keys in your Pirate Ship account.")) {
      return;
    }
    try {
      const result = await fetchWithAuth(`${serverUrl}/api/admin/integrations/pirateship/regenerate`, {
        method: "POST"
      });
      if (result && result.success) {
        const keyInput = document.getElementById("pirateship-consumer-key");
        const secretInput = document.getElementById("pirateship-consumer-secret");
        if (keyInput) keyInput.value = result.consumerKey;
        if (secretInput) secretInput.value = result.consumerSecret;
        showSuccessToast("New Pirate Ship keys generated successfully!");
      } else {
        showErrorToast("Failed to regenerate keys.");
      }
    } catch (err) {
      showErrorToast(`Error regenerating keys: ${err.message}`);
    }
  });

  document.getElementById("pirateship-auto-sync-toggle")?.addEventListener("change", async (e) => {
    const isChecked = e.target.checked;
    const statusBadge = document.getElementById("pirateship-sync-status-badge");
    try {
      const res = await fetchWithAuth(`${serverUrl}/api/admin/integrations/pirateship/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSync: isChecked })
      });
      if (res && res.success) {
        pirateShipAutoSync = isChecked;
        if (statusBadge) {
          statusBadge.textContent = `WooCommerce REST API v3 Compatible • Status: ${pirateShipAutoSync ? "Auto-Sync Active" : "Manual Queue Mode"}`;
        }
        showSuccessToast(`Pirate Ship Auto-Sync ${isChecked ? "enabled" : "disabled"}.`);

        // Invalidate cached order HTML to update panels immediately
        for (const ord of allOrders) {
          ord._cachedHtml = null;
        }
        const activeFilterBtn = document.querySelector(".filter-btn.active");
        const currentFilter = activeFilterBtn?.dataset?.status || "ALL";
        filterAndDisplayOrders(currentFilter);
      } else {
        throw new Error(res?.error || "Failed to update Pirate Ship auto-sync");
      }
    } catch (err) {
      showErrorToast(`Failed to update setting: ${err.message}`);
      e.target.checked = !isChecked;
    }
  });
}

// --- Address Formatting & Copying ---
export function formatFullShippingAddress(order) {
  if (!order) return "";
  const contact = order.shippingContact || order.customerDetails?.shipping || order.billingContact || order.customerDetails?.billing;
  if (!contact) return "";

  const name = [contact.givenName, contact.familyName].filter(Boolean).join(" ") ||
    contact.name ||
    order.customerDetails?.name ||
    order.customerName ||
    "";

  let lines = [];
  if (Array.isArray(contact.addressLines)) {
    lines = contact.addressLines.filter(Boolean);
  } else if (typeof contact.addressLines === "string" && contact.addressLines) {
    lines = [contact.addressLines];
  } else if (contact.street1 || contact.address1) {
    lines = [contact.street1 || contact.address1, contact.street2 || contact.address2].filter(Boolean);
  }

  const city = contact.locality || contact.city || "";
  const state = contact.administrativeDistrictLevel1 || contact.state || "";
  const zip = contact.postalCode || contact.zip || "";
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const country = contact.country && contact.country !== "US" ? contact.country : "";

  return [name, ...lines, cityStateZip, country].filter(Boolean).join("\n");
}

export async function copyShippingAddress(orderId, btnEl) {
  const order = allOrders.find((o) => o.orderId === orderId);
  if (!order) return;
  const addressText = formatFullShippingAddress(order);
  if (!addressText) {
    showErrorToast("No shipping address found for this order.");
    return;
  }

  const showFeedback = () => {
    if (btnEl) {
      const origContent = btnEl.innerHTML;
      btnEl.innerHTML = `<span class="text-green-600 font-bold">✓ Copied!</span>`;
      setTimeout(() => {
        btnEl.innerHTML = origContent;
      }, 2000);
    }
    showSuccessToast("Address copied to clipboard!");
  };

  try {
    await navigator.clipboard.writeText(addressText);
    showFeedback();
  } catch (err) {
    // Fallback for non-secure contexts or permission restrictions
    const ta = document.createElement("textarea");
    ta.value = addressText;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showFeedback();
    } catch (fallbackErr) {
      showErrorToast("Failed to copy address to clipboard.");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

// --- Order Shipping Label & Package Dimensions ---
export async function orderShippingLabel(orderId, btnEl) {
  const order = allOrders.find((o) => o.orderId === orderId);
  if (!order) return;

  const card = document.getElementById(`order-card-${orderId}`) || btnEl?.closest(".order-card") || btnEl?.closest("tr");
  let weightOz = order.packageWeightOz;
  let length = order.packageDimensions?.length;
  let width = order.packageDimensions?.width;
  let height = order.packageDimensions?.height;

  if (card) {
    const weightInput = card.querySelector(`.package-weight-input[data-order-id="${orderId}"]`) || card.querySelector(`.package-weight-input`);
    const lengthInput = card.querySelector(`.package-length-input[data-order-id="${orderId}"]`) || card.querySelector(`.package-length-input`);
    const widthInput = card.querySelector(`.package-width-input[data-order-id="${orderId}"]`) || card.querySelector(`.package-width-input`);
    const heightInput = card.querySelector(`.package-height-input[data-order-id="${orderId}"]`) || card.querySelector(`.package-height-input`);

    if (weightInput && weightInput.value) weightOz = parseFloat(weightInput.value);
    if (lengthInput && lengthInput.value) length = parseFloat(lengthInput.value);
    if (widthInput && widthInput.value) width = parseFloat(widthInput.value);
    if (heightInput && heightInput.value) height = parseFloat(heightInput.value);
  }

  weightOz = Number(weightOz) || 1.0;
  length = Number(length) || 6;
  width = Number(width) || 4;
  height = Number(height) || 0.5;

  const origBtnText = btnEl ? btnEl.innerHTML : "";
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "Ordering...";
  }

  try {
    const res = await fetchWithAuth(`${serverUrl}/api/orders/${encodeURIComponent(orderId)}/order-label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightOz, length, width, height })
    });

    if (res && res.success) {
      order.packageWeightOz = res.packageWeightOz ?? weightOz;
      order.packageDimensions = res.packageDimensions ?? { length, width, height };
      order.exportToPirateship = true;
      order.labelRequested = true;
      order._cachedHtml = null; // Invalidate cache

      if (res.trackingNumber) {
        order.trackingNumber = res.trackingNumber;
        order.courier = res.courier || "USPS";
      }
      if (res.labelUrl) {
        order.labelUrl = res.labelUrl;
      }

      if (res.easyPostGenerated) {
        showSuccessToast(`Label generated! Tracking: ${res.trackingNumber}`);
      } else {
        showSuccessToast(`Order queued for Pirate Ship! (${order.packageWeightOz} oz, ${order.packageDimensions.length}×${order.packageDimensions.width}×${order.packageDimensions.height}")`);
      }

      // Re-render
      const activeFilterBtn = document.querySelector(".filter-btn.active");
      const currentFilter = activeFilterBtn?.dataset?.status || "ALL";
      filterAndDisplayOrders(currentFilter);
    } else {
      throw new Error(res?.error || "Failed to order label");
    }
  } catch (err) {
    showErrorToast(`Error ordering label: ${err.message}`);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = origBtnText;
    }
  }
}

// --- Shipping & Fee Configuration ---
let cachedShippingConfig = null;

const DEFAULT_SHIPPING_CONFIG = {
  taxRate: 0.085,
  handlingFeeCents: 300,
  squareFeePercent: 0.029,
  squareFeeFixedCents: 30,
  gramsPerSqIn: 0.05,
  packageTareGrams: 28,
  pickupDiscountCents: 300,
  handlingFeePerItemCents: 0,
};

const DEFAULT_USPS_TIERS = [
  { maxOz: 1, rateCents: 430, label: "USPS First Class (~1 oz)" },
  { maxOz: 2, rateCents: 470, label: "USPS First Class (~2 oz)" },
  { maxOz: 3, rateCents: 510, label: "USPS First Class (~3 oz)" },
  { maxOz: 4, rateCents: 550, label: "USPS First Class (~4 oz)" },
  { maxOz: 8, rateCents: 680, label: "USPS First Class (~8 oz)" },
  { maxOz: 16, rateCents: 855, label: "USPS Priority Mail (~1 lb)" },
  { maxOz: 32, rateCents: 1050, label: "USPS Priority Mail (~2 lb)" },
  { maxOz: 48, rateCents: 1250, label: "USPS Priority Mail (~3 lb)" },
  { maxOz: 64, rateCents: 1450, label: "USPS Priority Mail (~4 lb)" },
  { maxOz: Infinity, rateCents: 1900, label: "USPS Priority Mail (>4 lb)" },
];

async function loadShippingConfig() {
  try {
    const data = await fetchWithAuth(`${serverUrl}/api/admin/shipping/config`);
    if (!data || !data.config) return;
    const c = data.config;
    cachedShippingConfig = c;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    // Tax rate stored as decimal (0.085), display as percentage (8.5)
    setVal("shipping-tax-rate",      ((c.taxRate || 0) * 100).toFixed(2));
    // Handling fee stored in cents, display as dollars
    setVal("shipping-handling-fee",  ((c.handlingFeeCents || 0) / 100).toFixed(2));
    // Per-sticker handling fee stored in cents, display as dollars
    setVal("shipping-handling-fee-per-item", ((c.handlingFeePerItemCents || 0) / 100).toFixed(2));
    // Square % stored as decimal (0.029), display as percentage (2.9)
    setVal("shipping-square-pct",    ((c.squareFeePercent || 0) * 100).toFixed(3));
    // Square fixed stored in cents, display as dollars
    setVal("shipping-square-fixed",  ((c.squareFeeFixedCents || 0) / 100).toFixed(2));
    setVal("shipping-grams-per-sqin", (c.gramsPerSqIn || 0).toFixed(3));
    setVal("shipping-tare-grams",     (c.packageTareGrams || 0).toFixed(0));
  } catch (err) {
    console.warn("[PRINTSHOP] Failed to load shipping config:", err);
  }
}

function initShippingConfigListeners() {
  const form = document.getElementById("shipping-config-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("shipping-config-status");

    const getNum = (id) => parseFloat(document.getElementById(id)?.value || "0");

    const payload = {
      // Input is %, convert back to decimal for storage
      taxRate:            getNum("shipping-tax-rate") / 100,
      // Input is $, convert to cents
      handlingFeeCents:   Math.round(getNum("shipping-handling-fee") * 100),
      handlingFeePerItemCents: Math.round(getNum("shipping-handling-fee-per-item") * 100),
      // Input is %, convert back to decimal
      squareFeePercent:   getNum("shipping-square-pct") / 100,
      // Input is $, convert to cents
      squareFeeFixedCents: Math.round(getNum("shipping-square-fixed") * 100),
      gramsPerSqIn:       getNum("shipping-grams-per-sqin"),
      packageTareGrams:   getNum("shipping-tare-grams"),
    };

    try {
      const result = await fetchWithAuth(`${serverUrl}/api/admin/shipping/config`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (result && result.success) {
        showSuccessToast("Shipping settings saved!");
        if (statusEl) {
          statusEl.textContent = "Saved ✓";
          statusEl.className = "text-sm text-green-600";
          setTimeout(() => { statusEl.textContent = ""; }, 3000);
        }
      } else {
        throw new Error("Server returned failure");
      }
    } catch (err) {
      showErrorToast(`Failed to save shipping settings: ${err.message}`);
      if (statusEl) {
        statusEl.textContent = "Save failed";
        statusEl.className = "text-sm text-red-600";
      }
    }
  });
}

// --- Promo Code Configuration ---
let currentPromoCodes = [];

function generateRandomPromoCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function isCodeExpiredUI(expiresAt) {
  if (!expiresAt) return false;
  const str = String(expiresAt).trim();
  if (!str) return false;
  const now = new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [year, month, day] = str.split("-").map(Number);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
    return now.getTime() > endOfDay.getTime();
  }
  const exp = new Date(str);
  return !isNaN(exp.getTime()) && now.getTime() > exp.getTime();
}

async function loadPromoConfig() {
  try {
    const data = await fetchWithAuth(`${serverUrl}/api/admin/promo/config`);
    if (!data || !data.config) return;

    if (Array.isArray(data.config.codes)) {
      currentPromoCodes = data.config.codes.map((c) => ({
        id: c.id || `promo_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        code: String(c.code || "").trim().toUpperCase(),
        type: c.type === "flat" ? "flat" : "percentage",
        amount: Number(c.amount !== undefined ? c.amount : 0),
        enabled: Boolean(c.enabled),
        maxUses: c.maxUses !== null && c.maxUses !== undefined && c.maxUses !== "" ? parseInt(c.maxUses, 10) : null,
        timesUsed: Number(c.timesUsed || 0),
        expiresAt: c.expiresAt ? String(c.expiresAt).trim() : null,
        resetTimesUsed: false,
      }));
    } else if (data.config.code) {
      currentPromoCodes = [
        {
          id: data.config.id || "promo_1",
          code: String(data.config.code).trim().toUpperCase(),
          type: data.config.type === "flat" ? "flat" : "percentage",
          amount: Number(data.config.amount || 0),
          enabled: Boolean(data.config.enabled),
          maxUses: data.config.maxUses ? parseInt(data.config.maxUses, 10) : null,
          timesUsed: Number(data.config.timesUsed || 0),
          expiresAt: data.config.expiresAt ? String(data.config.expiresAt).trim() : null,
          resetTimesUsed: false,
        },
      ];
    } else {
      currentPromoCodes = [];
    }

    renderPromoCodeCards();
  } catch (err) {
    console.warn("[PRINTSHOP] Failed to load promo config:", err);
  }
}

function renderPromoCodeCards() {
  const container = document.getElementById("promo-codes-container");
  const emptyState = document.getElementById("promo-empty-state");
  const summaryCounts = document.getElementById("promo-summary-counts");

  if (!container) return;

  if (currentPromoCodes.length === 0) {
    container.innerHTML = "";
    if (emptyState) emptyState.classList.remove("hidden");
    if (summaryCounts) summaryCounts.textContent = "0 promo codes";
    return;
  }

  if (emptyState) emptyState.classList.add("hidden");

  let activeCount = 0;
  let expiredCount = 0;
  for (const c of currentPromoCodes) {
    const expired = isCodeExpiredUI(c.expiresAt);
    if (expired) expiredCount++;
    if (c.enabled && !expired && (c.maxUses === null || c.timesUsed < c.maxUses)) {
      activeCount++;
    }
  }

  if (summaryCounts) {
    summaryCounts.textContent = `${activeCount} active · ${expiredCount} expired · ${currentPromoCodes.length} total`;
  }

  container.innerHTML = "";

  currentPromoCodes.forEach((item, idx) => {
    const isExpired = isCodeExpiredUI(item.expiresAt);
    const isLimitReached = Boolean(item.maxUses !== null && item.timesUsed >= item.maxUses);

    let statusBadgeClass = "bg-green-100 text-green-800 border-green-300";
    let statusBadgeText = "Active";

    if (!item.enabled) {
      statusBadgeClass = "bg-gray-100 text-gray-700 border-gray-300";
      statusBadgeText = "Inactive";
    } else if (isExpired) {
      statusBadgeClass = "bg-red-100 text-red-700 border-red-300";
      statusBadgeText = "Expired";
    } else if (isLimitReached) {
      statusBadgeClass = "bg-amber-100 text-amber-800 border-amber-300";
      statusBadgeText = "Limit Reached";
    }

    const card = document.createElement("div");
    card.className = "p-4 border rounded-lg bg-gray-50/70 shadow-sm border-gray-200 transition-all hover:border-gray-300 space-y-3";
    card.dataset.promoIndex = String(idx);

    card.innerHTML = `
      <div class="flex items-center justify-between pb-2 border-b border-gray-200">
        <div class="flex items-center gap-3">
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer promo-card-enabled" ${item.enabled ? "checked" : ""}>
            <div class="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
            <span class="ml-2 text-xs font-semibold text-gray-700">Enabled</span>
          </label>
          <span class="promo-card-status-badge text-xs font-bold px-2 py-0.5 rounded-full border ${statusBadgeClass}">
            ${statusBadgeText}
          </span>
        </div>
        <button type="button" class="promo-card-delete text-xs text-red-600 hover:text-red-800 font-semibold px-2 py-1 rounded hover:bg-red-50 transition-colors flex items-center gap-1" title="Delete promo code">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          Delete
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Promo Code</label>
          <div class="flex items-center gap-1.5">
            <input type="text" class="promo-card-code font-mono font-bold uppercase tracking-wider block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-2.5 py-1.5 border" value="${escapeHtml(item.code || "")}" placeholder="e.g. SUMMER25" maxlength="50" required>
            <button type="button" class="promo-card-generate px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-xs font-medium rounded shadow-sm text-gray-700 whitespace-nowrap" title="Generate random code">
              🎲 Random
            </button>
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type</label>
          <select class="promo-card-type block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-2 py-1.5 border bg-white">
            <option value="percentage" ${item.type === "percentage" ? "selected" : ""}>Percentage (%)</option>
            <option value="flat" ${item.type === "flat" ? "selected" : ""}>Flat Amount ($)</option>
          </select>
        </div>

        <div>
          <label class="promo-card-amount-label block text-xs font-medium text-gray-700 mb-1">
            ${item.type === "flat" ? "Discount ($)" : "Discount (%)"}
          </label>
          <input type="number" step="any" min="0" ${item.type === "percentage" ? 'max="100"' : ""} class="promo-card-amount block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-2.5 py-1.5 border" value="${item.amount !== undefined ? item.amount : ""}" placeholder="0" required>
        </div>

        <div class="sm:col-span-2">
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs font-medium text-gray-700">Expiration Date</label>
            ${isExpired ? `<span class="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.2 rounded border border-red-200">Expired</span>` : ""}
          </div>
          <input type="date" class="promo-card-expires block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs px-2.5 py-1.5 border bg-white" value="${item.expiresAt ? String(item.expiresAt).slice(0, 10) : ""}">
          <p class="text-[11px] text-gray-400 mt-0.5">Expires at 11:59:59 PM on date. Blank = no expiration.</p>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Usage Limit</label>
          <input type="number" min="1" step="1" class="promo-card-maxuses block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-2.5 py-1.5 border" value="${item.maxUses !== null && item.maxUses !== undefined ? item.maxUses : ""}" placeholder="Unlimited">
          <p class="text-[11px] text-gray-400 mt-0.5">Blank = unlimited</p>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Usage Tracker</label>
          <div class="flex items-center justify-between gap-1 mt-0.5">
            <span class="promo-card-times-used text-xs font-semibold px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-800">
              ${item.resetTimesUsed ? "0 (Pending Save)" : `${item.timesUsed || 0} uses`}
            </span>
            <button type="button" class="promo-card-reset text-[11px] text-gray-600 hover:text-indigo-600 font-medium px-1.5 py-1 rounded hover:bg-indigo-50 border border-gray-200 transition-colors" title="Reset counter to 0">
              🔄 Reset
            </button>
          </div>
        </div>
      </div>
    `;

    // Event handlers
    const enabledInput = card.querySelector(".promo-card-enabled");
    const codeInput = card.querySelector(".promo-card-code");
    const generateBtn = card.querySelector(".promo-card-generate");
    const typeSelect = card.querySelector(".promo-card-type");
    const amountInput = card.querySelector(".promo-card-amount");
    const amountLabel = card.querySelector(".promo-card-amount-label");
    const expiresInput = card.querySelector(".promo-card-expires");
    const maxUsesInput = card.querySelector(".promo-card-maxuses");
    const resetBtn = card.querySelector(".promo-card-reset");
    const deleteBtn = card.querySelector(".promo-card-delete");

    if (enabledInput) {
      enabledInput.addEventListener("change", () => {
        item.enabled = enabledInput.checked;
        renderPromoCodeCards();
      });
    }

    if (codeInput) {
      codeInput.addEventListener("input", (e) => {
        item.code = e.target.value.toUpperCase();
      });
    }

    if (generateBtn && codeInput) {
      generateBtn.addEventListener("click", () => {
        const newCode = generateRandomPromoCode();
        codeInput.value = newCode;
        item.code = newCode;
      });
    }

    if (typeSelect && amountLabel && amountInput) {
      typeSelect.addEventListener("change", () => {
        item.type = typeSelect.value;
        if (item.type === "flat") {
          amountLabel.textContent = "Discount ($)";
          amountInput.removeAttribute("max");
        } else {
          amountLabel.textContent = "Discount (%)";
          amountInput.setAttribute("max", "100");
        }
      });
    }

    if (amountInput) {
      amountInput.addEventListener("input", (e) => {
        item.amount = parseFloat(e.target.value) || 0;
      });
    }

    if (expiresInput) {
      expiresInput.addEventListener("change", (e) => {
        item.expiresAt = e.target.value ? e.target.value : null;
        renderPromoCodeCards();
      });
    }

    if (maxUsesInput) {
      maxUsesInput.addEventListener("input", (e) => {
        const val = e.target.value.trim();
        item.maxUses = val ? parseInt(val, 10) : null;
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (confirm(`Reset times used counter to 0 for promo code "${item.code || "this code"}"?`)) {
          item.resetTimesUsed = true;
          const timesUsedSpan = card.querySelector(".promo-card-times-used");
          if (timesUsedSpan) timesUsedSpan.textContent = "0 (Pending Save)";
          showSuccessToast("Usage counter will reset to 0 upon saving.");
        }
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Are you sure you want to delete promo code "${item.code || "this code"}"?`)) {
          currentPromoCodes.splice(idx, 1);
          renderPromoCodeCards();
          showSuccessToast("Promo code removed. Click 'Save Promo Settings' to commit.");
        }
      });
    }

    container.appendChild(card);
  });
}

function addPromoCode() {
  currentPromoCodes.push({
    id: `promo_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    code: generateRandomPromoCode(),
    type: "percentage",
    amount: 10,
    enabled: true,
    maxUses: null,
    timesUsed: 0,
    expiresAt: null,
    resetTimesUsed: false,
  });
  renderPromoCodeCards();
  const container = document.getElementById("promo-codes-container");
  if (container && container.lastElementChild) {
    container.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const codeInput = container.lastElementChild.querySelector(".promo-card-code");
    if (codeInput) codeInput.focus();
  }
}

function initPromoConfigListeners() {
  const form = document.getElementById("promo-config-form");
  const addBtn = document.getElementById("add-promo-code-btn");
  const emptyAddBtn = document.getElementById("empty-add-promo-btn");

  if (addBtn) {
    addBtn.addEventListener("click", () => addPromoCode());
  }
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener("click", () => addPromoCode());
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById("promo-config-status");

      // Validate all codes before sending
      const seenCodes = new Set();
      for (let i = 0; i < currentPromoCodes.length; i++) {
        const item = currentPromoCodes[i];
        const rawCode = String(item.code || "").trim().toUpperCase();

        if (!rawCode) {
          showErrorToast(`Promo code at row ${i + 1} cannot be empty.`);
          return;
        }
        if (rawCode.length > 50) {
          showErrorToast(`Promo code '${rawCode}' exceeds 50 characters.`);
          return;
        }
        if (seenCodes.has(rawCode)) {
          showErrorToast(`Duplicate promo code '${rawCode}' found. Each code must be unique.`);
          return;
        }
        seenCodes.add(rawCode);

        if (isNaN(item.amount) || item.amount < 0) {
          showErrorToast(`Discount amount for '${rawCode}' must be a non-negative number.`);
          return;
        }
        if (item.type === "percentage" && item.amount > 100) {
          showErrorToast(`Percentage discount for '${rawCode}' cannot exceed 100%.`);
          return;
        }
        if (item.maxUses !== null && item.maxUses !== undefined && item.maxUses !== "") {
          const maxNum = Number(item.maxUses);
          if (!Number.isInteger(maxNum) || maxNum < 1) {
            showErrorToast(`Usage limit for '${rawCode}' must be a positive integer.`);
            return;
          }
        }
      }

      const payload = {
        codes: currentPromoCodes.map((c) => ({
          id: c.id,
          code: String(c.code || "").trim().toUpperCase(),
          type: c.type === "flat" ? "flat" : "percentage",
          amount: Number(c.amount || 0),
          enabled: Boolean(c.enabled),
          maxUses: c.maxUses !== null && c.maxUses !== undefined && c.maxUses !== "" ? parseInt(c.maxUses, 10) : null,
          expiresAt: c.expiresAt ? String(c.expiresAt).trim() : null,
          resetTimesUsed: Boolean(c.resetTimesUsed),
        })),
      };

      try {
        const result = await fetchWithAuth(`${serverUrl}/api/admin/promo/config`, {
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (result && result.success) {
          showSuccessToast("Promo settings saved!");
          if (statusEl) {
            statusEl.textContent = "Saved ✓";
            statusEl.className = "text-sm text-green-600";
            setTimeout(() => {
              if (statusEl.textContent === "Saved ✓") statusEl.textContent = "";
            }, 3000);
          }
          await loadPromoConfig();
        } else {
          throw new Error(result?.error || "Server returned failure");
        }
      } catch (err) {
        showErrorToast(`Failed to save promo settings: ${err.message}`);
        if (statusEl) {
          statusEl.textContent = "Save failed";
          statusEl.className = "text-sm text-red-600";
        }
      }
    });
  }
}

// --- Retention & Storage Configuration ---
async function loadRetentionConfig() {
  try {
    const data = await fetchWithAuth(`${serverUrl}/api/admin/retention/config`);
    if (!data) return;
    const toggle = document.getElementById("purge-artwork-toggle");
    const countEl = document.getElementById("retention-canceled-count");
    const archivedCountEl = document.getElementById("retention-archived-count");

    if (toggle) toggle.checked = !!data.purgeArtworkOnFlush;
    if (countEl) countEl.textContent = data.canceledOrdersCount ?? 0;
    if (archivedCountEl) archivedCountEl.textContent = data.archivedOrdersCount ?? 0;
  } catch (err) {
    console.error("[SHOP] Error loading retention config:", err);
  }
}

async function saveRetentionConfig() {
  const toggle = document.getElementById("purge-artwork-toggle");
  const statusEl = document.getElementById("retention-config-status");
  if (!toggle) return;

  if (statusEl) {
    statusEl.textContent = "Saving...";
    statusEl.className = "text-sm text-gray-500";
  }

  try {
    const res = await fetchWithAuth(`${serverUrl}/api/admin/retention/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purgeArtworkOnFlush: toggle.checked })
    });
    if (res && res.success) {
      if (statusEl) {
        statusEl.textContent = "Retention settings saved!";
        statusEl.className = "text-sm text-green-600 font-semibold";
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
      }
    } else {
      throw new Error("Failed to save");
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = "text-sm text-red-600";
    }
  }
}

async function runRetentionFlushManual() {
  const confirmed = window.confirm("Run the 30-day retention archival now? Orders canceled more than 30 days ago will be archived. All order records, customer contact info, and pricing are permanently preserved.");
  if (!confirmed) return;

  const btn = document.getElementById("run-retention-flush-btn");
  if (btn) btn.disabled = true;

  try {
    const res = await fetchWithAuth(`${serverUrl}/api/admin/retention/flush`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays: 30 })
    });
    alert(`Retention archival completed. Archived ${res.flushedCount || 0} orders.`);
    await loadRetentionConfig();
    await fetchAndDisplayOrders();
  } catch (err) {
    alert(`Failed to run retention archival: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initRetentionListeners() {
  document.getElementById("save-retention-config-btn")?.addEventListener("click", saveRetentionConfig);
  document.getElementById("run-retention-flush-btn")?.addEventListener("click", runRetentionFlushManual);
  document.getElementById("close-history-modal-btn")?.addEventListener("click", closeOrderHistoryModal);
  document.getElementById("close-history-modal-footer-btn")?.addEventListener("click", closeOrderHistoryModal);
}

// --- Telegram Bot & Alert Cadence Configuration ---
async function loadTelegramConfig() {
  try {
    const data = await fetchWithAuth(`${serverUrl}/api/admin/telegram/config`);
    if (!data) return;

    const enabledToggle = document.getElementById("telegram-alerts-enabled");
    const thresholdInput = document.getElementById("telegram-stalled-threshold");
    const intervalInput = document.getElementById("telegram-check-interval");
    const repeatInput = document.getElementById("telegram-repeat-hours");

    if (enabledToggle) enabledToggle.checked = data.enabled !== false;
    if (thresholdInput) thresholdInput.value = data.stalledThresholdHours ?? 4;
    if (intervalInput) intervalInput.value = data.checkIntervalMinutes ?? 60;
    if (repeatInput) repeatInput.value = data.repeatReminderHours ?? 0;
  } catch (err) {
    console.error("[SHOP] Error loading Telegram config:", err);
  }
}

async function saveTelegramConfig(e) {
  if (e && typeof e.preventDefault === "function") {
    e.preventDefault();
  }

  const enabledToggle = document.getElementById("telegram-alerts-enabled");
  const thresholdInput = document.getElementById("telegram-stalled-threshold");
  const intervalInput = document.getElementById("telegram-check-interval");
  const repeatInput = document.getElementById("telegram-repeat-hours");
  const statusEl = document.getElementById("telegram-config-status");
  const saveBtn = document.getElementById("save-telegram-config-btn");

  if (!enabledToggle || !thresholdInput || !intervalInput || !repeatInput) return;

  const stalledThresholdHours = Number(thresholdInput.value);
  const checkIntervalMinutes = Number(intervalInput.value);
  const repeatReminderHours = Number(repeatInput.value);

  if (isNaN(stalledThresholdHours) || stalledThresholdHours <= 0 || stalledThresholdHours > 168) {
    alert("Stalled threshold must be a number between 1 and 168 hours.");
    return;
  }

  if (isNaN(checkIntervalMinutes) || checkIntervalMinutes < 1 || checkIntervalMinutes > 1440) {
    alert("Check cadence must be a number between 1 and 1440 minutes.");
    return;
  }

  if (isNaN(repeatReminderHours) || repeatReminderHours < 0 || repeatReminderHours > 168) {
    alert("Repeat nag cadence must be a number between 0 and 168 hours.");
    return;
  }

  if (statusEl) {
    statusEl.textContent = "Saving...";
    statusEl.className = "text-sm text-gray-500";
  }
  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await fetchWithAuth(`${serverUrl}/api/admin/telegram/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: enabledToggle.checked,
        stalledThresholdHours,
        checkIntervalMinutes,
        repeatReminderHours
      })
    });

    if (res && res.success) {
      if (statusEl) {
        statusEl.textContent = "Telegram settings saved!";
        statusEl.className = "text-sm text-green-600 font-semibold";
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
      }
    } else {
      throw new Error(res?.error || "Failed to save Telegram settings");
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = "text-sm text-red-600";
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function initTelegramConfigListeners() {
  document.getElementById("telegram-config-form")?.addEventListener("submit", saveTelegramConfig);
}




// --- Initialization ---
async function getServerSessionToken() {
  try {
    const response = await fetch(`${serverUrl}/api/server-info`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const { serverSessionToken } = await response.json();
    localStorage.setItem("serverSessionToken", serverSessionToken);
    console.log("[CLIENT] Initial server session token acquired.");
  } catch (error) {
    console.error("Could not acquire server session token.", error);
  }
}

/**
 * Verifies the current token with the server to ensure it's still valid.
 */
async function verifyInitialToken() {
  if (!authToken) {
    updateConnectionStatus("idle");
    return false;
  }

  updateConnectionStatus("connecting");
  try {
    // This endpoint should return user info if the token is valid, and 401 if not.
    const data = await fetchWithAuth(`${serverUrl}/api/auth/verify-token`);
    if (data.username) {
      setLoggedInState(authToken, data.username);
      // fetchAndDisplayOrders will set the final 'connected' status
      return true;
    }
    updateConnectionStatus("error");
    return false;
  } catch (error) {
    updateConnectionStatus("error");
    // fetchWithAuth handles the logout on 401, so we just catch other errors.
    console.error("Token verification failed:", error);
    logout(); // Ensure logout state if verification fails for any reason
    return false;
  }
}

/**
 * Fetches the CSRF token required for secure POST requests.
 */
async function getCsrfToken() {
  try {
    const response = await fetch(`${serverUrl}/api/csrf-token`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    csrfToken = data.csrfToken;
  } catch (error) {
    console.error(
      "Fatal: Could not fetch CSRF token. App may not function correctly.",
      error,
    );
    showErrorToast("Could not establish a secure session with the server.");
  }
}

/**
 * Main application entry point.
 */
export async function init() {
  authToken = localStorage.getItem("authToken");

  // This creates a verifier that automatically fetches and caches keys from your JWKS endpoint
  JWKS = jose.createRemoteJWKSet(
    new URL(`${serverUrl}/.well-known/jwks.json`, window.location.origin),
  );
  console.log("[CLIENT] Remote JWKS verifier created.");

  await getServerSessionToken();

  // Assign all DOM elements to the ui object
  const ids = [
    "orders-list",
    "no-orders-message",
    "refreshOrdersBtn",
    "nestStickersBtn",
    "nested-svg-container",
    "spacingInput",
    "addPrintingMarks",
    "registerBtn",
    "loginBtn",
    "auth-status",
    "loading-indicator",
    "error-toast",
    "error-message",
    "close-error-toast",
    "success-toast",
    "success-message",
    "close-success-toast",
    "searchInput",
    "searchBtn",
    "downloadCutFileBtn",
    "downloadCutFilePltBtn",
    "downloadXmlBtn",
    "downloadPdfBtn",
    "exportPdfBtn",
    "scan-mode-banner",
    "scanTargetStatus",
    "closeScanModeBtn",
    "previewCutlinesToggle",
    "rollMedia",
    "sheetHeight",
    "login-modal",
    "close-modal-btn",
    "username-input",
    "password-input",
    "password-login-btn",
    "webauthn-login-btn",
    "webauthn-register-btn",
    "connection-status-dot",
    "connection-status-text",
    "login-form",
    "pricing-editor-container",
    "save-pricing-btn",
    "reload-pricing-btn",
    "copy-pricing-btn",
    "printerProfile",
    "sheetWidth",
    "marginTop",
    "marginBottom",
    "marginLeft",
    "marginRight",
    "measurement-unit",
    "save-general-settings-btn",
    "kissCutLayerName",
    "kissCutColorPicker",
    "kissCutColor",
    "edgeCutLayerName",
    "edgeCutColorPicker",
    "edgeCutColor",
    "save-cut-settings-btn"
  ];
  ids.forEach((id) => {
    // Convert kebab-case to camelCase for keys
    const key = id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase());
    ui[key] = document.getElementById(id);
  });

  // Initialize Toast Managers
  if (ui.errorToast && ui.errorMessage) {
    errorToastManager = new ToastManager(ui.errorToast, ui.errorMessage, 5000);
  }
  if (ui.successToast && ui.successMessage) {
    successToastManager = new ToastManager(
      ui.successToast,
      ui.successMessage,
      3000,
    );
  }

  // Attach event listeners immediately so UI is responsive
  ui.ordersList?.addEventListener("click", handleOrderListClick);
  ui.ordersList?.addEventListener("change", handleOrderListChange);
    document.getElementById("active-printshop")?.addEventListener("change", () => fetchAndDisplayOrders(ui.searchInput?.value || ""));
  document.getElementById("printshop-selector")?.addEventListener("change", (e) => loadPrintshopForm(e.target.value));
  document.getElementById("printshop-config-form")?.addEventListener("submit", savePrintshopConfig);
  document.getElementById("delete-printshop-btn")?.addEventListener("click", deletePrintshop);

  ui.refreshOrdersBtn?.addEventListener("click", () => fetchAndDisplayOrders());
  ui.registerBtn?.addEventListener("click", handleRegistration);
  ui.closeErrorToast?.addEventListener("click", hideErrorToast);
  ui.closeSuccessToast?.addEventListener("click", hideSuccessToast);
  ui.nestStickersBtn?.addEventListener("click", handleNesting);
  ui.downloadCutFileBtn?.addEventListener("click", handleDownloadCutFile);
  ui.downloadCutFilePltBtn?.addEventListener("click", handleDownloadCutFilePlt);
  ui.downloadXmlBtn?.addEventListener("click", handleDownloadCutFileXml);
  ui.downloadPdfBtn?.addEventListener("click", handleDownloadPdf);
  ui.exportPdfBtn?.addEventListener("click", handleExportPdf);
  ui.searchBtn?.addEventListener("click", handleSearch);
  ui.savePricingBtn?.addEventListener("click", savePricingConfig);
  ui.reloadPricingBtn?.addEventListener("click", () => {
    loadPricingConfigEditor();
    showSuccessToast("Pricing reloaded from server.");
  });
  ui.copyPricingBtn?.addEventListener("click", () => {
    if (currentPricingConfig) {
      navigator.clipboard?.writeText(JSON.stringify(currentPricingConfig, null, 2));
      showSuccessToast("Pricing JSON copied to clipboard!");
    }
  });

  ui.previewCutlinesToggle?.addEventListener("change", (e) => {
    if (e.target.checked) {
      ui.nestedSvgContainer.classList.remove("hide-cutlines");
    } else {
      ui.nestedSvgContainer.classList.add("hide-cutlines");
    }
  });

  ui.rollMedia?.addEventListener("change", (e) => {
    if (e.target.checked) {
      ui.sheetHeight.disabled = true;
      ui.sheetHeight.classList.add("bg-gray-200");
    } else {
      ui.sheetHeight.disabled = false;
      ui.sheetHeight.classList.remove("bg-gray-200");
    }
  });

  ui.saveGeneralSettingsBtn?.addEventListener("click", () => {
    localStorage.setItem("splotchMeasurementUnit", ui["measurement-unit"].value);
    showSuccessToast("General Settings saved.");
  });

  // Initialize measurement unit from localStorage if present
  const savedUnit = localStorage.getItem("splotchMeasurementUnit");
  if (savedUnit && ui["measurement-unit"]) {
    ui["measurement-unit"].value = savedUnit;
    document.querySelectorAll("h3").forEach(h3 => {
      if (h3.textContent.includes("Sheet Dimensions")) {
        h3.textContent = `Sheet Dimensions (${savedUnit === "mm" ? "mm" : "Inches"})`;
      }
      if (h3.textContent.includes("Media Margins")) {
        h3.textContent = `Media Margins (${savedUnit === "mm" ? "mm" : "Inches"})`;
      }
    });
    
    // The HTML defaults are in inches. If we loaded "mm", we should convert the inputs.
    if (savedUnit === "mm") {
      const inputsToConvert = [ui.sheetWidth, ui.sheetHeight, ui.marginTop, ui.marginBottom, ui.marginLeft, ui.marginRight];
      inputsToConvert.forEach(input => {
        if (input && input.value) {
          input.value = parseFloat((parseFloat(input.value) * 25.4).toFixed(2));
        }
      });
    }
  }

  let lastUnit = ui["measurement-unit"]?.value || "inches";
  ui["measurement-unit"]?.addEventListener("change", (e) => {
    const newUnit = e.target.value;
    if (newUnit === lastUnit) return;
    const factor = newUnit === "mm" ? 25.4 : (1 / 25.4);
    
    // Convert inputs
    const inputsToConvert = [ui.sheetWidth, ui.sheetHeight, ui.marginTop, ui.marginBottom, ui.marginLeft, ui.marginRight];
    inputsToConvert.forEach(input => {
      if (input && input.value) {
        input.value = parseFloat((parseFloat(input.value) * factor).toFixed(2));
      }
    });
    
    // Update labels in HTML
    document.querySelectorAll("h3").forEach(h3 => {
      if (h3.textContent.includes("Sheet Dimensions")) {
        h3.textContent = `Sheet Dimensions (${newUnit === "mm" ? "mm" : "Inches"})`;
      }
      if (h3.textContent.includes("Media Margins")) {
        h3.textContent = `Media Margins (${newUnit === "mm" ? "mm" : "Inches"})`;
      }
    });

    lastUnit = newUnit;
  });

  ui.printerProfile?.addEventListener("change", (e) => {
    const profile = PrinterProfiles[e.target.value];
    if (profile) {
      if (profile.isCustom) {
        ui.sheetWidth.disabled = false;
        ui.sheetWidth.classList.remove("bg-gray-200");
        ui.marginTop.disabled = false;
        ui.marginTop.classList.remove("bg-gray-200");
        ui.marginBottom.disabled = false;
        ui.marginBottom.classList.remove("bg-gray-200");
        ui.marginLeft.disabled = false;
        ui.marginLeft.classList.remove("bg-gray-200");
        ui.marginRight.disabled = false;
        ui.marginRight.classList.remove("bg-gray-200");
      } else {
        const toCurrentUnit = ui["measurement-unit"]?.value === "mm" ? 25.4 : 1;
        ui.sheetWidth.value = parseFloat((profile.width * toCurrentUnit).toFixed(2));
        // Keep height user configurable unless it's roll media
        
        ui.marginTop.value = parseFloat((profile.margins.top * toCurrentUnit).toFixed(2));
        ui.marginBottom.value = parseFloat((profile.margins.bottom * toCurrentUnit).toFixed(2));
        ui.marginLeft.value = parseFloat((profile.margins.left * toCurrentUnit).toFixed(2));
        ui.marginRight.value = parseFloat((profile.margins.right * toCurrentUnit).toFixed(2));

        // Disable the inputs so they are read-only for standard profiles
        ui.sheetWidth.disabled = true;
        ui.sheetWidth.classList.add("bg-gray-200");
        ui.marginTop.disabled = true;
        ui.marginTop.classList.add("bg-gray-200");
        ui.marginBottom.disabled = true;
        ui.marginBottom.classList.add("bg-gray-200");
        ui.marginLeft.disabled = true;
        ui.marginLeft.classList.add("bg-gray-200");
        ui.marginRight.disabled = true;
        ui.marginRight.classList.add("bg-gray-200");
      }
    }
  });
  ui.searchInput?.addEventListener("keyup", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  const scanModeBtn = document.getElementById("scanModeBtn");
  const scanModeBanner = document.getElementById("scan-mode-banner");
  const closeScanModeBtn = document.getElementById("closeScanModeBtn");
  const toggleCameraScanBtn = document.getElementById("toggleCameraScanBtn");

  if (scanModeBtn) {
    scanModeBtn.addEventListener("click", () => {
      scanModeBanner?.classList.remove("hidden");
      startCameraScanner();
      ui.searchInput?.focus();
    });
  }

  if (closeScanModeBtn) {
    closeScanModeBtn.addEventListener("click", () => {
      stopCameraScanner();
      scanModeBanner?.classList.add("hidden");
    });
  }

  if (toggleCameraScanBtn) {
    toggleCameraScanBtn.addEventListener("click", () => {
      if (isCameraScanning) {
        stopCameraScanner();
      } else {
        startCameraScanner();
      }
    });
  }

  window.addEventListener("beforeunload", () => {
    stopCameraScanner();
  });

  // Global listener for barcode scanner
  document.addEventListener("keydown", handleBarcodeScan);

  // Select/Deselect All buttons
  const selectAllBtn = document.getElementById("selectAllOrdersBtn");
  const deselectAllBtn = document.getElementById("deselectAllOrdersBtn");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      document
        .querySelectorAll(".order-select-checkbox")
        .forEach((cb) => (cb.checked = true));
    });
  }
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener("click", () => {
      document
        .querySelectorAll(".order-select-checkbox")
        .forEach((cb) => (cb.checked = false));
    });
  }

  // Login Modal Listeners
  ui.closeModalBtn?.addEventListener("click", hideLoginModal);
  ui.loginForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    handlePasswordLogin(e);
  });
  ui.webauthnLoginBtn?.addEventListener("click", handleWebAuthnLogin);
  ui.webauthnRegisterBtn?.addEventListener("click", handleRegistration);

  // The main login button opens the modal
  ui.loginBtn?.addEventListener("click", showLoginModal);

  // Fetch CSRF token in background or await if strictly needed for initial load,
  // but we shouldn't block UI interactions that don't need it yet.
  // However, login NEEDS it. But opening the modal doesn't.
  // Let's await it but handle the case where it fails gracefully (it already catches error).
  await getCsrfToken();

  // Filter button logic
  const filterContainer = document.getElementById("filter-container");
  filterContainer?.addEventListener("click", (e) => {
    if (e.target.classList.contains("filter-btn")) {
      // Remove active class from all buttons
      filterContainer.querySelectorAll(".filter-btn").forEach((btn) => {
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
      });
      // Add active class to the clicked button
      e.target.classList.add("active");
      e.target.setAttribute("aria-pressed", "true");
      // Actually filter the orders
      const status = e.target.dataset.status;
      currentPage = 1;
      filterAndDisplayOrders(status);
    }
  });

  const toggleViewBtn = document.getElementById("toggle-view-btn");
  if (toggleViewBtn) {
    toggleViewBtn.addEventListener("click", () => {
      currentViewMode = currentViewMode === "card" ? "list" : "card";
      localStorage.setItem("splotchViewMode", currentViewMode);
      
      const activeFilter =
        document.querySelector("#filter-container .filter-btn.active")?.dataset
          .status || "ALL";
      filterAndDisplayOrders(activeFilter);
    });
  }
  
  const bulkStatusSelect = document.getElementById("bulk-status-select");
  if (bulkStatusSelect) {
    bulkStatusSelect.addEventListener("change", (e) => {
        const newStatus = e.target.value;
        if (newStatus) {
            const confirmed = window.confirm(`Are you sure you want to change all selected orders to ${newStatus}?`);
            if (confirmed) {
                handleBulkStatusUpdate(newStatus);
            } else {
                e.target.value = "";
            }
        }
    });
  }

  // --- View Switching ---
  const viewDashboardBtn = document.getElementById("view-dashboard-btn");
  const viewSettingsBtn = document.getElementById("view-settings-btn");
  const dashboardView = document.getElementById("dashboard-view");
  const settingsView = document.getElementById("settings-view");

  if (viewDashboardBtn && viewSettingsBtn) {
    viewDashboardBtn.addEventListener("click", () => {
      dashboardView.classList.remove("hidden");
      settingsView.classList.add("hidden");
      viewDashboardBtn.classList.add(
        "border-b-2",
        "border-blue-500",
        "font-bold",
        "text-blue-600",
      );
      viewDashboardBtn.classList.remove("text-gray-500");
      viewSettingsBtn.classList.remove(
        "border-b-2",
        "border-blue-500",
        "font-bold",
        "text-blue-600",
      );
      viewSettingsBtn.classList.add("text-gray-500");
    });

    viewSettingsBtn.addEventListener("click", () => {
      dashboardView.classList.add("hidden");
      settingsView.classList.remove("hidden");
      viewSettingsBtn.classList.add(
        "border-b-2",
        "border-blue-500",
        "font-bold",
        "text-blue-600",
      );
      viewSettingsBtn.classList.remove("text-gray-500");
      viewDashboardBtn.classList.remove(
        "border-b-2",
        "border-blue-500",
        "font-bold",
        "text-blue-600",
      );
      viewDashboardBtn.classList.add("text-gray-500");

      loadOdooConfig();
      loadPricingConfigEditor();
      loadPirateShipConfig();
      loadPromoConfig();
      loadShippingConfig();
      loadRetentionConfig();
      loadTelegramConfig();
      syncCutSettingsUI();
    });
  }

  // Odoo listeners
  document
    .getElementById("odoo-config-form")
    ?.addEventListener("submit", saveOdooConfig);
  document
    .getElementById("test-odoo-btn")
    ?.addEventListener("click", testOdooConnection);

  // Pirate Ship listeners
  initPirateShipListeners();
  // Promo Code listeners
  initPromoConfigListeners();
  // Shipping & Fee listeners
  initShippingConfigListeners();
  // Retention & Storage listeners
  initRetentionListeners();
  // Telegram Bot & Alert Cadence listeners
  initTelegramConfigListeners();
  // Cut Line & Layer Settings listeners
  initCutSettingsListeners();


  // Check for a token in the URL from OAuth redirect
  const urlParams = new URLSearchParams(window.location.search);
  const oauthToken = urlParams.get("token");
  if (oauthToken) {
    // We got a token from the OAuth redirect. Use it to log in.
    // The token is already verified by the server, but we call verifyInitialToken
    // to fetch user info and set the UI state correctly.
    localStorage.setItem("authToken", oauthToken);
    await verifyInitialToken();
    // Clean the token from the URL
    window.history.replaceState({}, document.title, "/printshop.html");
  } else {
    // Standard token check
    if (!(await verifyInitialToken())) {
      logout();
    }
  }

  // Start interval to poll metrics and uptime every 15 seconds
  setInterval(() => {
    if (authToken) {
      fetchAndDisplayMetrics();
    }
  }, 15000);

  window.__printshopInitialized = true;
}

document.addEventListener("DOMContentLoaded", init);

// --- Pricing Editor UI ---
currentPricingConfig = {};

async function loadPricingConfigEditor() {
  if (!ui.pricingEditorContainer) return;
  ui.pricingEditorContainer.innerHTML =
    '<p class="text-gray-500 text-center py-4">Loading pricing configuration...</p>';
  try {
    if (!cachedShippingConfig) {
      await loadShippingConfig().catch((e) =>
        console.warn("Could not load shipping config:", e)
      );
    }
    const config = await fetchWithAuth(`${serverUrl}/api/pricing-info`);
    currentPricingConfig = config;
    renderPricingEditor(currentPricingConfig);
  } catch (err) {
    ui.pricingEditorContainer.innerHTML = `<p class="text-red-500 text-center py-4">Error loading pricing: ${err.message}</p>`;
  }
}

export function renderPricingEditor(config) {
  if (!ui.pricingEditorContainer) return;

  const defaultHandlingDollars =
    cachedShippingConfig &&
    typeof cachedShippingConfig.handlingFeeCents === "number"
      ? (cachedShippingConfig.handlingFeeCents / 100).toFixed(2)
      : "3.00";

  const resolutions = config.resolutions || [];
  const materials = config.materials || [];
  const layers = config.layers || [];
  const complexity = config.complexity || { perLayerMultiplier: 0.1, tiers: [] };
  const quantityDiscounts = config.quantityDiscounts || [];
  const rawTradeoffs = config.tradeoffs || {};
  const defaultTradeoffsList = [
    { id: "rush", name: "Rush Production (+20%)", type: "percentage", value: 0.2, valueCents: 0, description: "Priority queue bump (24-48 hours)" },
    { id: "eco", name: "Economy / Flexible (-10%)", type: "percentage", value: -0.1, valueCents: 0, description: "Flexible filler window (5-7 business days)" },
    { id: "no_reprints", name: "No Reprints / Final Sale (-8%)", type: "percentage", value: -0.08, valueCents: 0, description: "Customer waives reprint requests" },
    { id: "flexible_window", name: "Flexible Filler Window (-6%)", type: "percentage", value: -0.06, valueCents: 0, description: "Permits printing during machine downtime filler runs" },
    { id: "print_ready", name: "Print-Ready Verification (-$10)", type: "flat", value: 0, valueCents: -1000, description: "Verified vector artwork with embedded cutline" },
    { id: "consolidated_shipping", name: "Consolidated Shipping (-$5)", type: "flat", value: 0, valueCents: -500, description: "Combines with pending batch orders" },
    { id: "rush_queue", name: "Rush Queue Jump (+25%)", type: "percentage", value: 0.25, valueCents: 0, description: "Guaranteed same-day printing queue bump" }
  ];

  let tradeoffsList = [];
  if (Array.isArray(rawTradeoffs)) {
    tradeoffsList = rawTradeoffs;
  } else if (typeof rawTradeoffs === "object" && Object.keys(rawTradeoffs).length > 0) {
    tradeoffsList = Object.entries(rawTradeoffs)
      .filter(([id]) => id !== "standard" && id !== "none")
      .map(([id, t]) => ({
        id,
        name: t.name || id,
        type: t.type || "percentage",
        value: typeof t.value === "number" ? t.value : 0,
        valueCents: typeof t.valueCents === "number" ? t.valueCents : 0,
        description: t.description || ""
      }));
  } else {
    tradeoffsList = defaultTradeoffsList;
  }

  let html = `
    <div class="space-y-6 text-gray-800">
      <!-- Base Price Card -->
      <div class="bg-slate-50 border border-slate-200 p-4 rounded-lg">
        <label class="block font-bold text-sm text-gray-700 mb-1">Base Price per Square Inch (Cents)</label>
        <div class="flex items-center gap-3">
          <input type="number" step="0.1" min="0" id="pricing-base-price" class="w-48 p-2 border border-gray-300 rounded-md font-semibold text-lg" value="${config.pricePerSquareInchCents || 0}">
          <span class="text-sm text-gray-500 font-medium">cents / sq inch (e.g. 13 = $0.13)</span>
        </div>
      </div>

      <!-- Resolutions Section -->
      <div class="border border-gray-200 p-4 rounded-lg bg-white shadow-sm">
        <div class="flex justify-between items-center mb-3">
          <div>
            <h4 class="font-bold text-base text-splotch-navy">Resolutions & PPI</h4>
            <p class="text-xs text-gray-500">Output resolutions selectable by customers with respective cost multipliers.</p>
          </div>
          <button type="button" id="add-res-btn" class="text-xs bg-indigo-50 text-indigo-600 font-bold px-3 py-1.5 rounded hover:bg-indigo-100 border border-indigo-200 transition-colors">+ Add Resolution</button>
        </div>
        <div id="pricing-resolutions-list" class="space-y-2">
          ${resolutions.map((r) => `
            <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center resolution-row bg-gray-50 p-2 rounded border border-gray-200">
              <input type="text" placeholder="ID (e.g. dpi_300)" class="p-1.5 text-xs border rounded w-32 res-id font-mono" value="${escapeHtml(r.id)}">
              <input type="text" placeholder="Display Name" class="p-1.5 text-xs border rounded flex-grow res-name font-medium" value="${escapeHtml(r.name)}">
              <div class="flex items-center gap-1">
                <span class="text-xs text-gray-400 font-mono">PPI:</span>
                <input type="number" min="1" placeholder="PPI" class="p-1.5 text-xs border rounded w-20 res-ppi" value="${r.ppi}">
              </div>
              <div class="flex items-center gap-1">
                <span class="text-xs text-gray-400 font-mono">Mult:</span>
                <input type="number" step="0.05" min="0" placeholder="Multiplier" class="p-1.5 text-xs border rounded w-20 res-mult" value="${r.costMultiplier}">
              </div>
              <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Resolution">&times;</button>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Materials Section -->
      <div class="border border-gray-200 p-4 rounded-lg bg-white shadow-sm">
        <div class="flex justify-between items-center mb-3">
          <div>
            <h4 class="font-bold text-base text-splotch-navy">Materials & Vinyl Types</h4>
            <p class="text-xs text-gray-500">Supported substrate finishes and compatible specialty print inks.</p>
          </div>
          <button type="button" id="add-mat-btn" class="text-xs bg-indigo-50 text-indigo-600 font-bold px-3 py-1.5 rounded hover:bg-indigo-100 border border-indigo-200 transition-colors">+ Add Material</button>
        </div>
        <div id="pricing-materials-list" class="space-y-3">
          ${materials.map((m) => `
            <div class="border border-gray-200 p-3 bg-gray-50 rounded-lg material-row space-y-2">
              <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                <input type="text" placeholder="ID (e.g. pp_standard)" class="p-1.5 text-xs border rounded w-36 mat-id font-mono" value="${escapeHtml(m.id)}">
                <input type="text" placeholder="Material Display Name" class="p-1.5 text-xs border rounded flex-grow mat-name font-medium" value="${escapeHtml(m.name)}">
                <div class="flex items-center gap-1">
                  <span class="text-xs text-gray-400 font-mono">Mult:</span>
                  <input type="number" step="0.05" min="0" placeholder="Multiplier" class="p-1.5 text-xs border rounded w-20 mat-mult" value="${m.costMultiplier}">
                </div>
                <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Material">&times;</button>
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Supported Layers (comma-separated layer types, e.g. white, cmyk, clear, inlay):</label>
                <input type="text" placeholder="white, cmyk, clear" class="w-full p-1.5 border rounded text-xs mat-layers font-mono bg-white" value="${escapeHtml((m.supportedLayers || []).join(", "))}">
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Description:</label>
                <input type="text" placeholder="Marketing description shown in tooltip" class="w-full p-1.5 border rounded text-xs mat-desc bg-white" value="${escapeHtml(m.description || "")}">
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Layers & Specialty Inks Section -->
      <div class="border border-gray-200 p-4 rounded-lg bg-white shadow-sm">
        <div class="flex justify-between items-center mb-3">
          <div>
            <h4 class="font-bold text-base text-splotch-navy">Print Layers & Specialty Inks</h4>
            <p class="text-xs text-gray-500">Custom ink passes (White underbase, Clear gloss, Inlays) and their optional subtypes.</p>
          </div>
          <button type="button" id="add-layer-btn" class="text-xs bg-indigo-50 text-indigo-600 font-bold px-3 py-1.5 rounded hover:bg-indigo-100 border border-indigo-200 transition-colors">+ Add Layer</button>
        </div>
        <div id="pricing-layers-list" class="space-y-3">
          ${layers.map((l) => `
            <div class="border border-gray-200 p-3 bg-gray-50 rounded-lg layer-row space-y-2">
              <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                <input type="text" placeholder="ID (e.g. white)" class="p-1.5 text-xs border rounded w-32 layer-id font-mono" value="${escapeHtml(l.id)}">
                <input type="text" placeholder="Layer Name (e.g. White)" class="p-1.5 text-xs border rounded flex-grow layer-name font-medium" value="${escapeHtml(l.name)}">
                <div class="flex items-center gap-1">
                  <span class="text-xs text-gray-400 font-mono">Mult:</span>
                  <input type="number" step="0.05" min="0" placeholder="Multiplier" class="p-1.5 text-xs border rounded w-20 layer-mult" value="${l.costMultiplier}">
                </div>
                <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Layer">&times;</button>
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Subtypes JSON Array (Optional, e.g. [{"id":"holographic","name":"Holographic","costMultiplier":1.0}]):</label>
                <textarea class="w-full p-1.5 border rounded text-xs layer-subtypes font-mono bg-white" rows="2">${escapeHtml(l.subTypes ? JSON.stringify(l.subTypes) : "[]")}</textarea>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Cutline Complexity Tiers Section -->
      <div class="border border-gray-200 p-4 rounded-lg bg-white shadow-sm">
        <div class="flex justify-between items-center mb-3">
          <div>
            <h4 class="font-bold text-base text-splotch-navy">Cutline Complexity</h4>
            <p class="text-xs text-gray-500">Perimeter-based multiplier tiers and multi-layer packaging penalties.</p>
          </div>
          <button type="button" id="add-complexity-tier-btn" class="text-xs bg-indigo-50 text-indigo-600 font-bold px-3 py-1.5 rounded hover:bg-indigo-100 border border-indigo-200 transition-colors">+ Add Complexity Tier</button>
        </div>

        <div class="mb-3">
          <label class="block text-xs font-semibold text-gray-600 mb-1">Per Additional Sticker/Layer Multiplier Penalty:</label>
          <input type="number" step="0.01" min="0" id="pricing-per-layer-mult" class="w-36 p-1.5 text-xs border rounded" value="${complexity.perLayerMultiplier || 0.1}">
        </div>

        <div id="pricing-complexity-list" class="space-y-2">
          ${(complexity.tiers || []).map((t) => `
            <div class="flex gap-2 items-center complexity-row bg-gray-50 p-2 rounded border border-gray-200">
              <span class="text-xs text-gray-500 font-medium">Perimeter up to:</span>
              <input type="text" placeholder="Inches (e.g. 12 or Infinity)" class="p-1.5 text-xs border rounded w-32 comp-threshold font-mono" value="${t.thresholdInches}">
              <span class="text-xs text-gray-500 font-medium">inches &rarr; Multiplier:</span>
              <input type="number" step="0.05" min="0" class="p-1.5 text-xs border rounded w-24 comp-multiplier font-mono" value="${t.multiplier}">
              <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Tier">&times;</button>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Quantity Discounts Section -->
      <div class="border border-gray-200 p-4 rounded-lg bg-white shadow-sm">
        <div class="flex justify-between items-center mb-3">
          <div>
            <h4 class="font-bold text-base text-splotch-navy">Bulk Quantity Discounts</h4>
            <p class="text-xs text-gray-500">Tiered volume discounts applied automatically during checkout.</p>
          </div>
          <button type="button" id="add-discount-btn" class="text-xs bg-indigo-50 text-indigo-600 font-bold px-3 py-1.5 rounded hover:bg-indigo-100 border border-indigo-200 transition-colors">+ Add Discount Tier</button>
        </div>
        <div id="pricing-discounts-list" class="space-y-2">
          ${quantityDiscounts.map((d) => `
            <div class="flex gap-3 items-center discount-row bg-gray-50 p-2 rounded border border-gray-200">
              <span class="text-xs text-gray-500 font-medium">Min Quantity:</span>
              <input type="number" min="1" placeholder="Quantity" class="p-1.5 text-xs border rounded w-28 disc-qty font-mono font-bold" value="${d.quantity}">
              <span class="text-xs text-gray-500 font-medium">&rarr; Discount (%):</span>
              <input type="number" min="0" max="100" step="1" placeholder="Discount %" class="p-1.5 text-xs border rounded w-24 disc-percent font-mono font-bold text-green-700" value="${Math.round((d.discount || 0) * 100)}">
              <span class="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200 disc-badge">${Math.round((d.discount || 0) * 100)}% OFF</span>
              <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn ml-auto" title="Delete Discount Tier">&times;</button>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Turnaround & Production Tradeoffs Section -->
      <div class="border border-gray-200 p-4 rounded-lg bg-white shadow-sm">
        <div class="flex justify-between items-center mb-3">
          <div>
            <h4 class="font-bold text-base text-splotch-navy">Turnaround &amp; Production Tradeoffs</h4>
            <p class="text-xs text-gray-500">Configure production turnaround modifiers (Rush surcharges, Economy discounts) and customer tradeoffs.</p>
          </div>
          <button type="button" id="add-tradeoff-btn" class="text-xs bg-indigo-50 text-indigo-600 font-bold px-3 py-1.5 rounded hover:bg-indigo-100 border border-indigo-200 transition-colors">+ Add Turnaround / Tradeoff</button>
        </div>
        <div id="pricing-tradeoffs-list" class="space-y-2">
          ${tradeoffsList.map((t) => {
            const isPct = t.type === "percentage";
            const displayVal = isPct ? Math.round((t.value || 0) * 100) : ((t.valueCents || 0) / 100).toFixed(2);
            return `
              <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center tradeoff-row bg-gray-50 p-2 rounded border border-gray-200">
                <input type="text" placeholder="ID (e.g. rush)" class="p-1.5 text-xs border rounded w-32 tradeoff-id font-mono font-medium" value="${escapeHtml(t.id)}">
                <input type="text" placeholder="Display Name (e.g. Rush Production)" class="p-1.5 text-xs border rounded flex-grow tradeoff-name font-medium" value="${escapeHtml(t.name)}">
                <select class="p-1.5 text-xs border rounded w-28 tradeoff-type font-medium bg-white">
                  <option value="percentage" ${isPct ? "selected" : ""}>Percent (%)</option>
                  <option value="flat" ${!isPct ? "selected" : ""}>Flat ($)</option>
                </select>
                <div class="flex items-center gap-1">
                  <span class="text-xs text-gray-400 font-mono tradeoff-unit-label">${isPct ? "%:" : "$:"}</span>
                  <input type="number" step="${isPct ? "1" : "0.5"}" placeholder="${isPct ? "e.g. 20" : "e.g. -10"}" class="p-1.5 text-xs border rounded w-24 tradeoff-val font-mono font-bold ${displayVal > 0 ? "text-indigo-600" : displayVal < 0 ? "text-green-700" : "text-gray-700"}" value="${displayVal}">
                </div>
                <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Tradeoff">&times;</button>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <!-- Live Pricing Calculator / Sandbox -->
      <div class="border-2 border-indigo-300 p-5 rounded-lg bg-indigo-50/50 shadow-md">
        <div class="flex items-center gap-2 mb-4">
          <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
          <h4 class="font-bold text-base text-indigo-900">Live Pricing Sandbox / Simulator</h4>
        </div>
        <p class="text-xs text-indigo-700 mb-4">Test your configured formulas and tier multipliers in real time against sample sticker specs:</p>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <label class="block text-[11px] font-bold text-indigo-800">Width (Inches):</label>
            <input type="number" step="0.5" id="sim-width" class="w-full p-1.5 text-xs border rounded bg-white" value="3">
          </div>
          <div>
            <label class="block text-[11px] font-bold text-indigo-800">Height (Inches):</label>
            <input type="number" step="0.5" id="sim-height" class="w-full p-1.5 text-xs border rounded bg-white" value="3">
          </div>
          <div>
            <label class="block text-[11px] font-bold text-indigo-800">Quantity:</label>
            <input type="number" min="1" id="sim-qty" class="w-full p-1.5 text-xs border rounded bg-white font-bold" value="100">
          </div>
          <div>
            <label class="block text-[11px] font-bold text-indigo-800">Perimeter (Inches):</label>
            <input type="number" step="1" id="sim-perimeter" class="w-full p-1.5 text-xs border rounded bg-white" value="12">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label class="block text-[11px] font-bold text-indigo-800">Material:</label>
            <select id="sim-mat" class="w-full p-1.5 text-xs border rounded bg-white font-medium"></select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-indigo-800">Resolution:</label>
            <select id="sim-res" class="w-full p-1.5 text-xs border rounded bg-white font-medium"></select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-indigo-800">Active Layers (Sample):</label>
            <select id="sim-layers" class="w-full p-1.5 text-xs border rounded bg-white font-medium">
              <option value="none">Base Only (CMYK)</option>
              <option value="white">Base + White Underbase</option>
              <option value="white_clear">Base + White + Clear Gloss</option>
              <option value="inlay">Base + Inlay (Holographic)</option>
            </select>
          </div>
        </div>

        <!-- Fulfillment, Shipping & Fees Simulator Controls -->
        <div class="border-t border-indigo-200/70 pt-3 mt-3">
          <div class="flex items-center gap-1.5 mb-2.5">
            <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            <h5 class="text-xs font-bold text-indigo-900 uppercase tracking-wide">Fulfillment, Shipping & Fees Simulation</h5>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <label class="block text-[11px] font-bold text-indigo-800">Fulfillment Method:</label>
              <select id="sim-delivery" class="w-full p-1.5 text-xs border rounded bg-white font-medium">
                <option value="ship">USPS Shipping (Tiered)</option>
                <option value="pickup">Local Pickup (Free + $3 Off)</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-bold text-indigo-800">Destination State:</label>
              <select id="sim-state" class="w-full p-1.5 text-xs border rounded bg-white font-medium">
                <option value="OK">Oklahoma (OK) [Taxable 8.5%]</option>
                <option value="TX">Texas (TX) [Tax Exempt]</option>
                <option value="CA">California (CA) [Tax Exempt]</option>
                <option value="OTHER">Out-of-State / Exempt [0%]</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-bold text-indigo-800">Handling Fee ($):</label>
              <input type="number" step="0.25" min="0" id="sim-handling-fee" class="w-full p-1.5 text-xs border rounded bg-white font-mono" value="${defaultHandlingDollars}" title="Base order handling fee">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-indigo-800">Turnaround / Tradeoffs:</label>
              <select id="sim-tradeoffs" class="w-full p-1.5 text-xs border rounded bg-white font-medium">
                <option value="none">Standard Production (0%)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Simulator Results Box -->
        <div class="bg-white p-4 rounded-lg border border-indigo-200 shadow-sm">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <!-- Left: Sticker Production & Volume Pricing -->
            <div class="space-y-1.5 text-xs text-gray-600 border-b md:border-b-0 md:border-r border-gray-200 pb-3 md:pb-0 md:pr-4">
              <div class="font-bold text-indigo-900 text-[11px] uppercase tracking-wider mb-2 flex items-center gap-1">
                <span>Sticker Specs & Production</span>
              </div>
              <div class="flex justify-between items-center">
                <span>Single Sticker Area:</span>
                <span class="font-semibold text-gray-800"><span id="sim-out-sqin">9.0</span> sq in</span>
              </div>
              <div class="flex justify-between items-center">
                <span>Estimated Package Weight:</span>
                <span class="font-semibold text-gray-800" id="sim-out-weight">~1.2 oz</span>
              </div>
              <div class="flex justify-between items-center">
                <span>Combined Multipliers:</span>
                <span id="sim-out-mult" class="font-bold text-indigo-600">1.30x</span>
              </div>
              <div class="flex justify-between items-center">
                <span>Base Sticker Cost:</span>
                <span id="sim-out-undisc" class="font-mono text-gray-700">$0.00</span>
              </div>
              <div class="flex justify-between items-center text-green-700 font-semibold">
                <span>Volume Discount (<span id="sim-out-disc">0% OFF</span>):</span>
                <span id="sim-out-save" class="font-mono">-$0.00</span>
              </div>
              <div class="flex justify-between items-center font-bold text-gray-900 border-t border-gray-100 pt-1.5">
                <span>Sticker Subtotal:</span>
                <span class="font-mono text-splotch-navy text-sm font-extrabold"><span id="sim-out-subtotal">$0.00</span> <span id="sim-out-unit" class="text-xs text-gray-500 font-normal">($0.00 / ea)</span></span>
              </div>
            </div>

            <!-- Right: Shipping, Handling, Taxes & Grand Total -->
            <div class="space-y-1.5 text-xs text-gray-600">
              <div class="font-bold text-indigo-900 text-[11px] uppercase tracking-wider mb-2 flex items-center gap-1">
                <span>Shipping, Handling & Taxes</span>
              </div>
              <div class="flex justify-between items-center">
                <span id="sim-out-ship-label">Shipping (USPS First Class):</span>
                <span id="sim-out-shipping" class="font-mono font-semibold text-gray-800">+$0.00</span>
              </div>
              <div class="flex justify-between items-center">
                <span id="sim-out-handling-label">Handling Fee:</span>
                <span id="sim-out-handling" class="font-mono font-semibold text-gray-800">+$3.00</span>
              </div>
              <div class="flex justify-between items-center">
                <span id="sim-out-tax-label">Sales Tax (8.5% OK):</span>
                <span id="sim-out-tax" class="font-mono font-semibold text-gray-800">+$0.00</span>
              </div>
              <div class="flex justify-between items-center text-gray-500">
                <span>Square Processing (2.9% + 30¢):</span>
                <span id="sim-out-square" class="font-mono">+$0.00</span>
              </div>
              <div class="flex justify-between items-baseline border-t-2 border-indigo-200 pt-2 mt-1">
                <span class="text-xs font-black text-splotch-navy uppercase tracking-wide">Customer Grand Total:</span>
                <span id="sim-out-total" class="text-2xl font-black text-indigo-700 font-mono">$0.00</span>
              </div>
              <div class="flex justify-between items-center text-[11px] bg-green-50 p-2 rounded border border-green-200 mt-2">
                <span class="text-green-800 font-medium">Est. Print Shop Net Payout:</span>
                <span id="sim-out-net" class="font-mono font-bold text-green-900">$0.00</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  ui.pricingEditorContainer.innerHTML = html;

  // Add Dynamic Row Event Handlers
  document.getElementById("add-res-btn")?.addEventListener("click", () => {
    const div = document.createElement("div");
    div.className =
      "flex flex-wrap sm:flex-nowrap gap-2 items-center resolution-row bg-gray-50 p-2 rounded border border-gray-200";
    div.innerHTML = `
      <input type="text" placeholder="ID (e.g. dpi_custom)" class="p-1.5 text-xs border rounded w-32 res-id font-mono" value="dpi_${Date.now().toString().slice(-4)}">
      <input type="text" placeholder="Display Name" class="p-1.5 text-xs border rounded flex-grow res-name font-medium" value="Custom DPI">
      <div class="flex items-center gap-1">
        <span class="text-xs text-gray-400 font-mono">PPI:</span>
        <input type="number" min="1" placeholder="PPI" class="p-1.5 text-xs border rounded w-20 res-ppi" value="300">
      </div>
      <div class="flex items-center gap-1">
        <span class="text-xs text-gray-400 font-mono">Mult:</span>
        <input type="number" step="0.05" min="0" placeholder="Multiplier" class="p-1.5 text-xs border rounded w-20 res-mult" value="1.0">
      </div>
      <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Resolution">&times;</button>
    `;
    document.getElementById("pricing-resolutions-list").appendChild(div);
    updateSimulatorDropdowns();
    runSimulator();
  });

  document.getElementById("add-mat-btn")?.addEventListener("click", () => {
    const div = document.createElement("div");
    div.className =
      "border border-gray-200 p-3 bg-gray-50 rounded-lg material-row space-y-2";
    div.innerHTML = `
      <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center">
        <input type="text" placeholder="ID (e.g. mat_custom)" class="p-1.5 text-xs border rounded w-36 mat-id font-mono" value="mat_${Date.now().toString().slice(-4)}">
        <input type="text" placeholder="Material Display Name" class="p-1.5 text-xs border rounded flex-grow mat-name font-medium" value="New Vinyl Material">
        <div class="flex items-center gap-1">
          <span class="text-xs text-gray-400 font-mono">Mult:</span>
          <input type="number" step="0.05" min="0" placeholder="Multiplier" class="p-1.5 text-xs border rounded w-20 mat-mult" value="1.0">
        </div>
        <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Material">&times;</button>
      </div>
      <div>
        <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Supported Layers (comma-separated):</label>
        <input type="text" placeholder="white, cmyk, clear" class="w-full p-1.5 border rounded text-xs mat-layers font-mono bg-white" value="white, cmyk, clear">
      </div>
      <div>
        <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Description:</label>
        <input type="text" placeholder="Description" class="w-full p-1.5 border rounded text-xs mat-desc bg-white" value="">
      </div>
    `;
    document.getElementById("pricing-materials-list").appendChild(div);
    updateSimulatorDropdowns();
    runSimulator();
  });

  document.getElementById("add-layer-btn")?.addEventListener("click", () => {
    const div = document.createElement("div");
    div.className =
      "border border-gray-200 p-3 bg-gray-50 rounded-lg layer-row space-y-2";
    div.innerHTML = `
      <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center">
        <input type="text" placeholder="ID (e.g. specialty_ink)" class="p-1.5 text-xs border rounded w-32 layer-id font-mono" value="layer_${Date.now().toString().slice(-4)}">
        <input type="text" placeholder="Layer Name" class="p-1.5 text-xs border rounded flex-grow layer-name font-medium" value="Specialty Layer">
        <div class="flex items-center gap-1">
          <span class="text-xs text-gray-400 font-mono">Mult:</span>
          <input type="number" step="0.05" min="0" placeholder="Multiplier" class="p-1.5 text-xs border rounded w-20 layer-mult" value="1.1">
        </div>
        <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Layer">&times;</button>
      </div>
      <div>
        <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Subtypes JSON Array (Optional):</label>
        <textarea class="w-full p-1.5 border rounded text-xs layer-subtypes font-mono bg-white" rows="2">[]</textarea>
      </div>
    `;
    document.getElementById("pricing-layers-list").appendChild(div);
    runSimulator();
  });

  document
    .getElementById("add-complexity-tier-btn")
    ?.addEventListener("click", () => {
      const div = document.createElement("div");
      div.className =
        "flex gap-2 items-center complexity-row bg-gray-50 p-2 rounded border border-gray-200";
      div.innerHTML = `
        <span class="text-xs text-gray-500 font-medium">Perimeter up to:</span>
        <input type="text" placeholder="Inches" class="p-1.5 text-xs border rounded w-32 comp-threshold font-mono" value="36">
        <span class="text-xs text-gray-500 font-medium">inches &rarr; Multiplier:</span>
        <input type="number" step="0.05" min="0" class="p-1.5 text-xs border rounded w-24 comp-multiplier font-mono" value="1.3">
        <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Tier">&times;</button>
      `;
      document.getElementById("pricing-complexity-list").appendChild(div);
      runSimulator();
    });

  document
    .getElementById("add-discount-btn")
    ?.addEventListener("click", () => {
      const div = document.createElement("div");
      div.className =
        "flex gap-3 items-center discount-row bg-gray-50 p-2 rounded border border-gray-200";
      div.innerHTML = `
        <span class="text-xs text-gray-500 font-medium">Min Quantity:</span>
        <input type="number" min="1" placeholder="Quantity" class="p-1.5 text-xs border rounded w-28 disc-qty font-mono font-bold" value="1000">
        <span class="text-xs text-gray-500 font-medium">&rarr; Discount (%):</span>
        <input type="number" min="0" max="100" step="1" placeholder="Discount %" class="p-1.5 text-xs border rounded w-24 disc-percent font-mono font-bold text-green-700" value="20">
        <span class="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200 disc-badge">20% OFF</span>
        <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn ml-auto" title="Delete Discount Tier">&times;</button>
      `;
      document.getElementById("pricing-discounts-list").appendChild(div);
      runSimulator();
    });

  document
    .getElementById("add-tradeoff-btn")
    ?.addEventListener("click", () => {
      const div = document.createElement("div");
      div.className =
        "flex flex-wrap sm:flex-nowrap gap-2 items-center tradeoff-row bg-gray-50 p-2 rounded border border-gray-200";
      div.innerHTML = `
        <input type="text" placeholder="ID (e.g. rush_expedited)" class="p-1.5 text-xs border rounded w-32 tradeoff-id font-mono font-medium" value="rush_expedited">
        <input type="text" placeholder="Display Name" class="p-1.5 text-xs border rounded flex-grow tradeoff-name font-medium" value="Expedited Rush (+35%)">
        <select class="p-1.5 text-xs border rounded w-28 tradeoff-type font-medium bg-white">
          <option value="percentage" selected>Percent (%)</option>
          <option value="flat">Flat ($)</option>
        </select>
        <div class="flex items-center gap-1">
          <span class="text-xs text-gray-400 font-mono tradeoff-unit-label">%:</span>
          <input type="number" step="1" placeholder="e.g. 20" class="p-1.5 text-xs border rounded w-24 tradeoff-val font-mono font-bold text-indigo-600" value="35">
        </div>
        <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-base remove-row-btn" title="Delete Tradeoff">&times;</button>
      `;
      document.getElementById("pricing-tradeoffs-list")?.appendChild(div);
      updateSimulatorDropdowns();
      runSimulator();
    });

  // Delegate event for all remove buttons and dynamic badges
  ui.pricingEditorContainer.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-row-btn")) {
      const row =
        e.target.closest(".layer-row") ||
        e.target.closest(".material-row") ||
        e.target.closest(".resolution-row") ||
        e.target.closest(".complexity-row") ||
        e.target.closest(".discount-row") ||
        e.target.closest(".tradeoff-row") ||
        e.target.parentElement;
      if (row) row.remove();
      updateSimulatorDropdowns();
      runSimulator();
    }
  });

  ui.pricingEditorContainer.addEventListener("change", (e) => {
    if (e.target.classList.contains("tradeoff-type")) {
      const row = e.target.closest(".tradeoff-row");
      const isPct = e.target.value === "percentage";
      const label = row?.querySelector(".tradeoff-unit-label");
      const input = row?.querySelector(".tradeoff-val");
      if (label) label.textContent = isPct ? "%:" : "$:";
      if (input) {
        input.step = isPct ? "1" : "0.5";
        input.placeholder = isPct ? "e.g. 20" : "e.g. -10";
      }
      updateSimulatorDropdowns();
      runSimulator();
    }
  });

  ui.pricingEditorContainer.addEventListener("input", (e) => {
    if (e.target.classList.contains("disc-percent")) {
      const row = e.target.closest(".discount-row");
      const badge = row?.querySelector(".disc-badge");
      if (badge) {
        badge.textContent = `${e.target.value || 0}% OFF`;
      }
    }
    if (e.target.closest(".tradeoff-row")) {
      updateSimulatorDropdowns();
    }
    runSimulator();
  });

  // Simulator controls listener
  document.getElementById("sim-width")?.addEventListener("input", runSimulator);
  document.getElementById("sim-height")?.addEventListener("input", runSimulator);
  document.getElementById("sim-qty")?.addEventListener("input", runSimulator);
  document.getElementById("sim-perimeter")?.addEventListener("input", runSimulator);
  document.getElementById("sim-mat")?.addEventListener("change", runSimulator);
  document.getElementById("sim-res")?.addEventListener("change", runSimulator);
  document.getElementById("sim-layers")?.addEventListener("change", runSimulator);
  document.getElementById("sim-delivery")?.addEventListener("change", runSimulator);
  document.getElementById("sim-state")?.addEventListener("change", runSimulator);
  document.getElementById("sim-handling-fee")?.addEventListener("input", runSimulator);
  document.getElementById("sim-tradeoffs")?.addEventListener("change", runSimulator);

  updateSimulatorDropdowns();
  runSimulator();
}

function updateSimulatorDropdowns() {
  const matSelect = document.getElementById("sim-mat");
  const resSelect = document.getElementById("sim-res");
  const tradeoffSelect = document.getElementById("sim-tradeoffs");

  if (matSelect) {
    const currentMat = matSelect.value;
    matSelect.innerHTML = "";
    document.querySelectorAll(".material-row").forEach((row) => {
      const id = row.querySelector(".mat-id")?.value.trim();
      const name = row.querySelector(".mat-name")?.value.trim();
      if (id) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name || id;
        matSelect.appendChild(opt);
      }
    });
    if (currentMat && matSelect.querySelector(`option[value="${currentMat}"]`)) {
      matSelect.value = currentMat;
    }
  }

  if (resSelect) {
    const currentRes = resSelect.value;
    resSelect.innerHTML = "";
    document.querySelectorAll(".resolution-row").forEach((row) => {
      const id = row.querySelector(".res-id")?.value.trim();
      const name = row.querySelector(".res-name")?.value.trim();
      if (id) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name || id;
        resSelect.appendChild(opt);
      }
    });
    if (currentRes && resSelect.querySelector(`option[value="${currentRes}"]`)) {
      resSelect.value = currentRes;
    }
  }

  if (tradeoffSelect) {
    const currentTradeoff = tradeoffSelect.value;
    tradeoffSelect.innerHTML = "";

    // Always provide Standard Production (0%)
    const standardOpt = document.createElement("option");
    standardOpt.value = "none";
    standardOpt.textContent = "Standard Production (0%)";
    tradeoffSelect.appendChild(standardOpt);

    document.querySelectorAll(".tradeoff-row").forEach((row) => {
      const id = row.querySelector(".tradeoff-id")?.value.trim();
      const name = row.querySelector(".tradeoff-name")?.value.trim();
      const type = row.querySelector(".tradeoff-type")?.value || "percentage";
      const val = parseFloat(row.querySelector(".tradeoff-val")?.value) || 0;

      if (!id || id === "none" || id === "standard") return;

      let suffix = "";
      if (type === "percentage") {
        const sign = val > 0 ? "+" : "";
        suffix = ` (${sign}${val}%)`;
      } else {
        const sign = val > 0 ? "+$" : "-$";
        suffix = ` (${sign}${Math.abs(val).toFixed(2)})`;
      }

      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${name || id}${name?.includes("(") ? "" : suffix}`;
      tradeoffSelect.appendChild(opt);
    });

    if (currentTradeoff && tradeoffSelect.querySelector(`option[value="${currentTradeoff}"]`)) {
      tradeoffSelect.value = currentTradeoff;
    }
  }
}

export function runSimulator() {
  const basePriceCents =
    parseFloat(document.getElementById("pricing-base-price")?.value) || 0;
  const widthInches =
    parseFloat(document.getElementById("sim-width")?.value) || 0;
  const heightInches =
    parseFloat(document.getElementById("sim-height")?.value) || 0;
  const qty = parseInt(document.getElementById("sim-qty")?.value, 10) || 1;
  const perimeterInches =
    parseFloat(document.getElementById("sim-perimeter")?.value) || 0;
  const matId = document.getElementById("sim-mat")?.value;
  const resId = document.getElementById("sim-res")?.value;
  const layersMode = document.getElementById("sim-layers")?.value;

  if (widthInches <= 0 || heightInches <= 0 || qty <= 0) return;

  const sqInches = widthInches * heightInches;

  // 1. Material Multiplier
  let matMult = 1.0;
  document.querySelectorAll(".material-row").forEach((row) => {
    if (row.querySelector(".mat-id")?.value.trim() === matId) {
      matMult = parseFloat(row.querySelector(".mat-mult")?.value) || 1.0;
    }
  });

  // 2. Resolution Multiplier
  let resMult = 1.0;
  document.querySelectorAll(".resolution-row").forEach((row) => {
    if (row.querySelector(".res-id")?.value.trim() === resId) {
      resMult = parseFloat(row.querySelector(".res-mult")?.value) || 1.0;
    }
  });

  // 3. Complexity Multiplier
  let compMult = 1.0;
  const compRows = Array.from(
    document.querySelectorAll(".complexity-row")
  ).map((row) => {
    const rawThresh = row.querySelector(".comp-threshold")?.value.trim();
    const threshold =
      rawThresh === "Infinity" || isNaN(parseFloat(rawThresh))
        ? Infinity
        : parseFloat(rawThresh);
    const mult =
      parseFloat(row.querySelector(".comp-multiplier")?.value) || 1.0;
    return { threshold, mult };
  });

  compRows.sort((a, b) => a.threshold - b.threshold);
  for (const tier of compRows) {
    if (perimeterInches <= tier.threshold) {
      compMult = tier.mult;
      break;
    }
  }

  // 4. Custom Layers Penalty
  let layerAdd = 0;
  if (layersMode === "white") {
    layerAdd += 0.1; // White layer multiplier
  } else if (layersMode === "white_clear") {
    layerAdd += 0.3; // White + Clear
  } else if (layersMode === "inlay") {
    layerAdd += 0.5; // Inlay
  }

  const combinedMultiplier = matMult * resMult * (compMult + layerAdd);

  // 5. Quantity Discount
  let discountPercent = 0;
  const discountRows = Array.from(
    document.querySelectorAll(".discount-row")
  ).map((row) => {
    const q = parseInt(row.querySelector(".disc-qty")?.value, 10) || 0;
    const p = parseFloat(row.querySelector(".disc-percent")?.value) || 0;
    return { q, discount: p / 100 };
  });
  discountRows.sort((a, b) => b.q - a.q); // Descending
  for (const tier of discountRows) {
    if (qty >= tier.q) {
      discountPercent = tier.discount;
      break;
    }
  }

  const baseCostCents = sqInches * basePriceCents;
  const totalCentsBeforeDiscount =
    baseCostCents * qty * combinedMultiplier;
  let stickerTotalCents = Math.round(
    totalCentsBeforeDiscount * (1 - discountPercent)
  );

  // Ceiling check matching client and server
  for (const higherTier of discountRows) {
    if (higherTier.q > qty) {
      const higherTierTotal = Math.round(
        baseCostCents * higherTier.q * combinedMultiplier * (1 - higherTier.discount)
      );
      if (stickerTotalCents > higherTierTotal) {
        stickerTotalCents = higherTierTotal;
        discountPercent =
          totalCentsBeforeDiscount > 0
            ? 1 - stickerTotalCents / totalCentsBeforeDiscount
            : 0;
      }
    }
  }

  // 6. Tradeoffs / Turnaround Modifier
  const selectedTradeoffId =
    document.getElementById("sim-tradeoffs")?.value || "none";
  let tradeoffCents = 0;

  if (
    selectedTradeoffId &&
    selectedTradeoffId !== "none" &&
    selectedTradeoffId !== "standard"
  ) {
    let matchedRow = null;
    document.querySelectorAll(".tradeoff-row").forEach((row) => {
      if (row.querySelector(".tradeoff-id")?.value.trim() === selectedTradeoffId) {
        matchedRow = row;
      }
    });

    if (matchedRow) {
      const type = matchedRow.querySelector(".tradeoff-type")?.value || "percentage";
      const val = parseFloat(matchedRow.querySelector(".tradeoff-val")?.value) || 0;
      if (type === "percentage") {
        tradeoffCents = Math.round(stickerTotalCents * (val / 100));
      } else {
        tradeoffCents = Math.round(val * 100);
      }
    } else if (currentPricingConfig?.tradeoffs?.[selectedTradeoffId]) {
      const def = currentPricingConfig.tradeoffs[selectedTradeoffId];
      if (def.type === "percentage") {
        tradeoffCents = Math.round(stickerTotalCents * (def.value || 0));
      } else if (def.type === "flat") {
        tradeoffCents = def.valueCents || 0;
      }
    } else {
      if (selectedTradeoffId === "rush") tradeoffCents = Math.round(stickerTotalCents * 0.2);
      else if (selectedTradeoffId === "eco") tradeoffCents = Math.round(stickerTotalCents * -0.1);
    }
  }

  const adjustedStickerSubtotalCents = Math.max(
    0,
    stickerTotalCents + tradeoffCents
  );

  const savingsCents = Math.max(
    0,
    Math.round(totalCentsBeforeDiscount) - stickerTotalCents
  );
  const unitDollars = (adjustedStickerSubtotalCents / qty / 100).toFixed(2);

  // 7. Shipping & Package Weight Calculation
  const shippingCfg = cachedShippingConfig || DEFAULT_SHIPPING_CONFIG;
  const totalSqIn = sqInches * qty;
  const gramsPerSqIn =
    typeof shippingCfg.gramsPerSqIn === "number"
      ? shippingCfg.gramsPerSqIn
      : 0.05;
  const tareGrams =
    typeof shippingCfg.packageTareGrams === "number"
      ? shippingCfg.packageTareGrams
      : 28;
  const totalWeightGrams = totalSqIn * gramsPerSqIn + tareGrams;
  const weightOz = totalWeightGrams / 28.3495;

  const deliveryMethod =
    document.getElementById("sim-delivery")?.value || "ship";
  const destinationState =
    document.getElementById("sim-state")?.value || "OK";
  const isPickup = deliveryMethod === "pickup";

  let shippingCents = 0;
  let shippingLabel = "Shipping (USPS):";
  let pickupDiscountCents = 0;

  if (isPickup) {
    shippingCents = 0;
    shippingLabel = "Local Pickup (Free):";
    const configuredPickupDiscount =
      typeof shippingCfg.pickupDiscountCents === "number"
        ? shippingCfg.pickupDiscountCents
        : 300;
    pickupDiscountCents = Math.min(
      adjustedStickerSubtotalCents,
      configuredPickupDiscount
    );
  } else {
    const minWeight = Math.max(weightOz, 1);
    const tier =
      DEFAULT_USPS_TIERS.find((t) => minWeight <= t.maxOz) ||
      DEFAULT_USPS_TIERS[DEFAULT_USPS_TIERS.length - 1];
    shippingCents = tier.rateCents;
    shippingLabel = `Shipping (${tier.label}):`;
    pickupDiscountCents = 0;
  }

  const netStickerSubtotalCents = Math.max(
    0,
    adjustedStickerSubtotalCents - pickupDiscountCents
  );

  // 8. Handling Fee
  const customHandlingVal = parseFloat(
    document.getElementById("sim-handling-fee")?.value
  );
  const baseHandlingCents = !isNaN(customHandlingVal)
    ? Math.round(customHandlingVal * 100)
    : typeof shippingCfg.handlingFeeCents === "number"
      ? shippingCfg.handlingFeeCents
      : 300;
  const perItemHandlingCents =
    (typeof shippingCfg.handlingFeePerItemCents === "number"
      ? shippingCfg.handlingFeePerItemCents
      : 0) * qty;
  const totalHandlingCents = baseHandlingCents + perItemHandlingCents;

  // 9. Sales Tax
  const isOkState = /^(ok|oklahoma)$/i.test(String(destinationState).trim());
  const isTaxable = isPickup || isOkState;
  const taxRate = isTaxable
    ? typeof shippingCfg.taxRate === "number"
      ? shippingCfg.taxRate
      : 0.085
    : 0;
  const taxCents = isTaxable
    ? Math.round((netStickerSubtotalCents + shippingCents) * taxRate)
    : 0;

  // 10. Square Processing Fee (2.9% + 30¢)
  const squarePct =
    typeof shippingCfg.squareFeePercent === "number"
      ? shippingCfg.squareFeePercent
      : 0.029;
  const squareFixed =
    typeof shippingCfg.squareFeeFixedCents === "number"
      ? shippingCfg.squareFeeFixedCents
      : 30;
  const preTotalCents =
    netStickerSubtotalCents + shippingCents + totalHandlingCents + taxCents;
  const squareFeeCents = Math.ceil(preTotalCents * squarePct) + squareFixed;

  // 11. Customer Grand Total
  const grandTotalCents = preTotalCents + squareFeeCents;

  // 12. Estimated Print Shop Net Payout (Grand Total - Square Fee - Tax - USPS Postage)
  const netPayoutCents =
    grandTotalCents - squareFeeCents - taxCents - (isPickup ? 0 : shippingCents);

  // Format Weight for Display
  let formattedWeight = "";
  if (weightOz < 16) {
    formattedWeight = `~${weightOz.toFixed(1)} oz`;
  } else {
    formattedWeight = `~${(weightOz / 16).toFixed(1)} lb (${weightOz.toFixed(0)} oz)`;
  }

  // Update simulator UI DOM elements
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setTxt("sim-out-sqin", sqInches.toFixed(1));
  setTxt("sim-out-weight", formattedWeight);
  setTxt("sim-out-mult", `${combinedMultiplier.toFixed(2)}x`);
  setTxt(
    "sim-out-undisc",
    `$${(totalCentsBeforeDiscount / 100).toFixed(2)}`
  );
  setTxt("sim-out-disc", `${Math.round(discountPercent * 100)}% OFF`);
  setTxt("sim-out-save", `-$${(savingsCents / 100).toFixed(2)}`);
  setTxt(
    "sim-out-subtotal",
    `$${(adjustedStickerSubtotalCents / 100).toFixed(2)}`
  );
  setTxt("sim-out-unit", `($${unitDollars} / sticker)`);

  setTxt("sim-out-ship-label", shippingLabel);
  if (isPickup) {
    setTxt(
      "sim-out-shipping",
      pickupDiscountCents > 0
        ? `-$${(pickupDiscountCents / 100).toFixed(2)} (Pickup Disc)`
        : "$0.00 (Pickup)"
    );
  } else {
    setTxt("sim-out-shipping", `+$${(shippingCents / 100).toFixed(2)}`);
  }

  const handlingLabel =
    perItemHandlingCents > 0
      ? `Handling Fee ($${(baseHandlingCents / 100).toFixed(2)} + $${(perItemHandlingCents / 100).toFixed(2)} item fee):`
      : "Handling Fee:";
  setTxt("sim-out-handling-label", handlingLabel);
  setTxt("sim-out-handling", `+$${(totalHandlingCents / 100).toFixed(2)}`);

  const taxLabel = isTaxable
    ? `Sales Tax (${(taxRate * 100).toFixed(1)}% OK):`
    : "Sales Tax (Exempt):";
  setTxt("sim-out-tax-label", taxLabel);
  setTxt("sim-out-tax", `+$${(taxCents / 100).toFixed(2)}`);

  setTxt("sim-out-square", `+$${(squareFeeCents / 100).toFixed(2)}`);
  setTxt("sim-out-total", `$${(grandTotalCents / 100).toFixed(2)}`);
  setTxt("sim-out-net", `$${(netPayoutCents / 100).toFixed(2)}`);
}

async function savePricingConfig() {
  if (!ui.pricingEditorContainer) return;
  const btn = ui.savePricingBtn;
  setButtonLoading(btn, true, "Saving...");

  try {
    const basePrice =
      parseFloat(document.getElementById("pricing-base-price")?.value) || 0;
    if (basePrice <= 0) {
      throw new Error("Base price per square inch must be greater than 0.");
    }

    const config = {
      pricePerSquareInchCents: basePrice,
      resolutions: [],
      materials: [],
      layers: [],
      complexity: {
        description: "Multiplier based on the perimeter of the cut path.",
        perLayerMultiplier:
          parseFloat(
            document.getElementById("pricing-per-layer-mult")?.value
          ) || 0.1,
        tiers: [],
      },
      quantityDiscounts: [],
    };

    // Gather Resolutions
    document.querySelectorAll(".resolution-row").forEach((row) => {
      const id = row.querySelector(".res-id").value.trim();
      const name = row.querySelector(".res-name").value.trim();
      const ppi = parseInt(row.querySelector(".res-ppi").value, 10) || 300;
      const costMultiplier =
        parseFloat(row.querySelector(".res-mult").value) || 1.0;

      if (!id) throw new Error("Resolution ID cannot be empty.");
      config.resolutions.push({ id, name, ppi, costMultiplier });
    });

    // Gather Materials
    document.querySelectorAll(".material-row").forEach((row) => {
      const id = row.querySelector(".mat-id").value.trim();
      const name = row.querySelector(".mat-name").value.trim();
      const costMultiplier =
        parseFloat(row.querySelector(".mat-mult").value) || 1.0;
      const layersStr = row.querySelector(".mat-layers").value;
      const description = row.querySelector(".mat-desc").value.trim();

      if (!id) throw new Error("Material ID cannot be empty.");
      config.materials.push({
        id,
        name,
        costMultiplier,
        supportedLayers: layersStr
          ? layersStr
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        description,
      });
    });

    // Gather Layers
    document.querySelectorAll(".layer-row").forEach((row) => {
      const id = row.querySelector(".layer-id").value.trim();
      const name = row.querySelector(".layer-name").value.trim();
      const costMultiplier =
        parseFloat(row.querySelector(".layer-mult").value) || 1.0;

      if (!id) throw new Error("Layer ID cannot be empty.");
      const layer = { id, name, costMultiplier };

      const subTypesText =
        row.querySelector(".layer-subtypes")?.value.trim() || "[]";
      try {
        const subTypes = JSON.parse(subTypesText);
        if (Array.isArray(subTypes) && subTypes.length > 0) {
          layer.subTypes = subTypes;
        }
      } catch (e) {
        throw new Error(`Invalid JSON in subtypes for layer "${id}".`);
      }
      config.layers.push(layer);
    });

    // Gather Complexity Tiers
    document.querySelectorAll(".complexity-row").forEach((row) => {
      const rawThresh = row.querySelector(".comp-threshold").value.trim();
      const thresholdInches =
        rawThresh === "Infinity" || isNaN(parseFloat(rawThresh))
          ? "Infinity"
          : parseFloat(rawThresh);
      const multiplier =
        parseFloat(row.querySelector(".comp-multiplier").value) || 1.0;
      config.complexity.tiers.push({ thresholdInches, multiplier });
    });

    // Gather Quantity Discounts
    document.querySelectorAll(".discount-row").forEach((row) => {
      const quantity =
        parseInt(row.querySelector(".disc-qty").value, 10) || 1;
      const percent =
        parseFloat(row.querySelector(".disc-percent").value) || 0;
      config.quantityDiscounts.push({
        quantity,
        discount: +(percent / 100).toFixed(4),
      });
    });

    // Sort discounts by quantity ascending
    config.quantityDiscounts.sort((a, b) => a.quantity - b.quantity);

    // Gather Turnaround / Tradeoffs
    config.tradeoffs = {
      standard: {
        name: "Standard Production",
        type: "percentage",
        value: 0,
        description: "Standard 3-5 business day production turnaround."
      }
    };

    document.querySelectorAll(".tradeoff-row").forEach((row) => {
      const id = row.querySelector(".tradeoff-id")?.value.trim();
      const name = row.querySelector(".tradeoff-name")?.value.trim();
      const type = row.querySelector(".tradeoff-type")?.value || "percentage";
      const val = parseFloat(row.querySelector(".tradeoff-val")?.value) || 0;

      if (!id || id === "standard" || id === "none") return;

      if (type === "percentage") {
        config.tradeoffs[id] = {
          name: name || id,
          type: "percentage",
          value: +(val / 100).toFixed(4),
          description: name || id
        };
      } else {
        config.tradeoffs[id] = {
          name: name || id,
          type: "flat",
          valueCents: Math.round(val * 100),
          description: name || id
        };
      }
    });

    // Save via Authenticated API
    await fetchWithAuth(`${serverUrl}/api/admin/pricing`, {
      method: "POST",
      body: JSON.stringify(config),
    });

    showSuccessToast("Pricing configuration saved successfully!");
    await loadPricingConfigEditor(); // refresh UI
  } catch (err) {
    showErrorToast(err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Renders the pagination controls based on the total number of items
 */
function renderPagination(totalItems) {
  const container = document.getElementById("pagination-container");
  if (!container) return;

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = "";
  
  // Previous button
  html += `<button class="px-3 py-1 border rounded-md bg-white text-gray-600 hover:bg-gray-50 ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}" 
           ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">Prev</button>`;

  // Page numbers
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="px-3 py-1 border rounded-md ${currentPage === i ? 'bg-splotch-navy text-white font-bold' : 'bg-white text-gray-600 hover:bg-gray-50'}" 
             data-page="${i}">${i}</button>`;
  }

  // Next button
  html += `<button class="px-3 py-1 border rounded-md bg-white text-gray-600 hover:bg-gray-50 ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''}" 
           ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next</button>`;
           
  container.innerHTML = html;

  // Add event listeners
  container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
          const newPage = parseInt(e.target.dataset.page, 10);
          if (!isNaN(newPage) && newPage >= 1 && newPage <= totalPages) {
              currentPage = newPage;
              const activeFilter = document.querySelector("#filter-container .filter-btn.active")?.dataset.status || "ALL";
              filterAndDisplayOrders(activeFilter);
              // Scroll to top of list
              document.getElementById("orders-list").scrollIntoView({ behavior: "smooth" });
          }
      });
  });
}

/**
 * Returns an alert object if the order is critically late or untouched.
 */
function getOrderAlert(order) {
    if (!order.receivedAt) return null;
    
    const status = order.status;
    const receivedAt = new Date(order.receivedAt).getTime();
    const now = Date.now();
    const hoursSince = (now - receivedAt) / (1000 * 60 * 60);

    // Untouched: NEW or PENDING for > 24h
    if ((status === 'NEW' || status === 'PENDING') && hoursSince > 24) {
        return { type: 'untouched', text: 'Untouched (24h+)', classes: 'bg-orange-500 text-white border-orange-600', icon: '⚠️' };
    }

    // Critically Late: Not shipped/completed/delivered/canceled for > 5 days (120h)
    if (!['SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELED'].includes(status) && hoursSince > 120) {
        return { type: 'late', text: 'Critically Late (5d+)', classes: 'bg-red-600 text-white border-red-700 animate-pulse', icon: '🚨' };
    }
    
    return null;
}


// --- Customer Chat / Messaging ---
window.toggleChat = function(orderId) {
    const container = document.getElementById(`chat-container-${orderId}`);
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        window.fetchMessages(orderId);
    } else {
        container.classList.add('hidden');
    }
};

window.fetchMessages = async function(orderId) {
    const historyContainer = document.getElementById(`chat-history-${orderId}`);
    try {
        const token = localStorage.getItem('splotchToken');
        const res = await fetch(`/api/orders/${orderId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to fetch messages');
        const messages = await res.json();
        
        if (messages.length === 0) {
            historyContainer.innerHTML = '<em class="text-xs text-gray-400">No messages yet. Send an email to the customer to start a conversation.</em>';
            return;
        }

        historyContainer.innerHTML = messages.map(msg => `
            <div class="${msg.sender === 'printshop' ? 'bg-blue-100 self-end' : 'bg-gray-200 self-start'} rounded p-2 max-w-[80%]">
                <div class="text-[10px] text-gray-500 mb-1">${new Date(msg.timestamp).toLocaleString()} (${msg.sender})</div>
                <div>${escapeHtml(msg.content)}</div>
            </div>
        `).join('');
        
        // Scroll to bottom
        historyContainer.scrollTop = historyContainer.scrollHeight;
    } catch (e) {
        console.error(e);
        historyContainer.innerHTML = '<em class="text-xs text-red-400">Error loading messages.</em>';
    }
};

window.sendMessage = async function(orderId) {
    const input = document.getElementById(`chat-input-${orderId}`);
    const message = input.value.trim();
    if (!message) return;

    try {
        const token = localStorage.getItem('splotchToken');
        const res = await fetch(`/api/orders/${orderId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ message })
        });
        
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to send message');
        }

        input.value = '';
        window.fetchMessages(orderId);
    } catch (e) {
        console.error(e);
        alert('Failed to send email: ' + e.message);
    }
};
