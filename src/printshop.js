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

// --- Global Variables ---
const serverUrl = ""; // Use relative paths for API calls
let authToken;
let csrfToken;
let allOrders = []; // To store a complete list of orders for filtering
let JWKS; // To hold the remote key set verifier
const svgCache = new Map(); // Cache for SVG strings to avoid redundant fetches
let currentViewMode = localStorage.getItem('splotchViewMode') || 'card';

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
    const errorData = await response.json().catch(() => {
      // Provide a more descriptive error if we can't parse JSON (e.g. proxy returned 500 without a body)
      console.error(
        `[fetchWithAuth] Received non-JSON error response. HTTP Status: ${response.status}`,
      );
      return {
        error: `Server error: Could not process response (Status ${response.status})`,
      };
    });
    throw new Error(
      errorData.error || `HTTP error! Status: ${response.status}`,
    );
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

    // Encode binary data to Base64URL before sending to server
    const verificationPayload = {
      username,
      id: authResp.id,
      rawId: authResp.rawId,
      type: authResp.type,
      response: {
        clientDataJSON: authResp.response.clientDataJSON,
        authenticatorData: authResp.response.authenticatorData,
        signature: authResp.response.signature,
        userHandle: authResp.response.userHandle,
      },
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
    showErrorToast(`WebAuthn Login Failed: ${error.message}`);
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

    // Encode binary data before sending for verification
    const verificationPayload = {
      username,
      id: regResp.id,
      rawId: regResp.rawId,
      type: regResp.type,
      response: {
        clientDataJSON: regResp.response.clientDataJSON,
        attestationObject: regResp.response.attestationObject,
      },
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
    showErrorToast(`Registration Failed: ${error.message}`);
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
    // After fetching, display with the current filter (defaults to ALL)
    const activeFilter =
      document.querySelector("#filter-container .filter-btn.active")?.dataset
        .status || "ALL";
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
      : allOrders.filter((order) => order.status === status);

  const noOrdersText = document.getElementById("no-orders-text");

  if (ordersToDisplay.length === 0) {
    // Clear orders but keep message
    ui.ordersList.innerHTML = "";
    ui.ordersList.appendChild(ui.noOrdersMessage);

    if (noOrdersText)
      noOrdersText.textContent = `No orders found with status: ${status}.`;
    ui.noOrdersMessage.style.display = "block";
  } else {
    ui.noOrdersMessage.style.display = "none";

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
      html += ordersToDisplay
        .slice()
        .reverse()
        .map((order) => displayOrderRow(order))
        .join("");
      html += `
            </tbody>
          </table>
        </div>
      `;
    } else {
      html = ordersToDisplay
        .slice()
        .reverse()
        .map((order) => displayOrder(order))
        .join("");
    }

    // Update innerHTML and restore the message element (hidden)
    ui.ordersList.innerHTML = html;
    ui.ordersList.appendChild(ui.noOrdersMessage);

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

// --- Start Table Row View ---
function displayOrderRow(order) {
  const orderId = order.orderId;
  const receivedAt = new Date(order.receivedAt).toLocaleString();
  const quantity = order.orderDetails?.quantity || order.quantity || 0;
  const price = (order.amount / 100).toFixed(2);

  const billingName = escapeHtml(
    order.customerDetails?.billing?.name || "N/A",
  );
  const billingEmail = escapeHtml(
    order.customerDetails?.billing?.email || order.customerEmail || "N/A",
  );

  const serverPrefix = serverUrl;
  const designImagePath = `${serverPrefix}${escapeHtml(order.designImagePath || "")}`;
  const cutFilePath = escapeHtml(
    order.orderDetails?.cutLinePath || order.cutLinePath || "",
  );
  const pltFilePath = order.pltFile ? `${serverPrefix}${order.pltFile}` : null;

  const statuses = [
    "NEW",
    "ACCEPTED",
    "PRINTING",
    "SHIPPED",
    "DELIVERED",
    "COMPLETED",
    "CANCELED",
  ];
  const statusColors = {
    NEW: "bg-blue-100 text-blue-800",
    ACCEPTED: "bg-amber-100 text-amber-800",
    PRINTING: "bg-purple-100 text-purple-800",
    SHIPPED: "bg-yellow-100 text-yellow-800",
    DELIVERED: "bg-green-100 text-green-800",
    COMPLETED: "bg-gray-100 text-gray-800",
    CANCELED: "bg-red-100 text-red-800",
  };
  const statusClass =
    statusColors[order.status?.toUpperCase()] || "bg-gray-500 text-white";

  const dropdownHtml = `
    <select class="action-dropdown border rounded-md p-1 text-sm bg-white ${statusClass}" data-order-id="${orderId}">
        ${statuses.map((s) => `<option value="${s}" ${order.status === s ? "selected" : ""}>${s.charAt(0) + s.slice(1).toLowerCase()}</option>`).join("")}
    </select>
  `;

  return `
    <tr class="bg-white border-b hover:bg-gray-50 order-row" data-order-id="${orderId}">
      <td class="px-4 py-3">
        <input type="checkbox" class="order-select-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500" value="${orderId}">
      </td>
      <td class="px-4 py-3">
        <div class="qr-code-container w-12 h-12" data-order-id="${orderId}">
            <canvas id="qr-${orderId}" width="48" height="48"></canvas>
        </div>
      </td>
      <td class="px-4 py-3">
        <div class="font-bold text-gray-900">${orderId.substring(0, 8)}...</div>
        <div class="text-xs text-gray-500">${receivedAt}</div>
        <div class="mt-1 font-semibold text-green-600">$${price}</div>
      </td>
      <td class="px-4 py-3">
        <div class="font-medium text-gray-900">${billingName}</div>
        <div class="text-xs text-gray-500"><a href="mailto:${billingEmail}" class="hover:underline">${billingEmail}</a></div>
      </td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-2">
            ${designImagePath && order.designImagePath ? `<a href="${designImagePath}" target="_blank" class="block w-12 h-12 bg-gray-100 rounded overflow-hidden flex-shrink-0 sticker-peel-container">
                <img src="${designImagePath}" alt="Design" class="sticker-design w-full h-full object-contain" data-cut-file-path="${cutFilePath}" data-quantity="${quantity}" loading="lazy" decoding="async">
            </a>` : `<div class="block w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400">N/A</div>`}
            <div>
                <div class="text-xs font-semibold">Qty: ${quantity}</div>
                ${cutFilePath ? `<a href="${serverPrefix}${cutFilePath}" target="_blank" download class="text-[10px] text-blue-600 hover:underline inline-block mt-1">Download SVG</a>` : ""}
                ${pltFilePath ? `<a href="${pltFilePath}" target="_blank" download class="text-[10px] text-blue-600 hover:underline inline-block ml-1 mt-1">Download PLT</a>` : ""}
            </div>
        </div>
      </td>
      <td class="px-4 py-3">
        <div class="flex flex-col gap-2">
            ${dropdownHtml}
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

  const quantity = escapeHtml(order.orderDetails?.quantity || "N/A");
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
    SHIPPED: "bg-yellow-100 text-yellow-800",
    DELIVERED: "bg-green-100 text-green-800",
    COMPLETED: "bg-gray-100 text-gray-800",
    CANCELED: "bg-red-100 text-red-800",
  };
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
    "SHIPPED",
    "DELIVERED",
    "COMPLETED",
    "CANCELED",
  ];
  const dropdownHtml = `
        <select class="action-dropdown border rounded p-1 text-sm font-bold ${statusClass} mt-4" data-order-id="${orderId}">
            ${statuses.map((s) => `<option value="${s}" ${status === s ? "selected" : ""}>${s.charAt(0) + s.slice(1).toLowerCase()}</option>`).join("")}
        </select>
    `;

  // Tracking section
  const trackingDisplay = order.status === "SHIPPED" ? "block" : "none";
  const courierOptions = ["usps", "ups", "fedex"]
    .map((c) => `<option value="${c}">${c.toUpperCase()}</option>`)
    .join("");

  const html = `
    <div class="order-card border-l-4 ${statusClass.split(" ")[0].replace("bg-", "border-")}" id="order-card-${orderId}">
        <div class="flex justify-between items-start">
            <div class="flex items-start">
                <input type="checkbox" class="order-select-checkbox mt-1 mr-3 w-5 h-5 cursor-pointer rounded text-blue-600 focus:ring-blue-500 shadow-sm" data-order-id="${orderId}">
                <div>
                    <h3 class="text-xl text-splotch-red">Order ID: <span class="font-mono text-sm">${orderIdShort}...</span></h3>
                    <p class="text-sm text-gray-600">Received: ${escapeHtml(receivedDate)}</p>
                </div>
            </div>
            <div class="${statusClass} font-bold py-1 px-3 rounded-full text-sm" id="status-badge-${orderId}">${status}</div>
        </div>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 order-details">
            <div>
                <dt>Billing Name:</dt><dd>${billingName}</dd>
                <dt>Billing Email:</dt><dd>${billingEmail}</dd>
            </div>
            <div>
                <dt>Shipping Name:</dt><dd>${shippingName}</dd>
                <dt>Shipping Email:</dt><dd>${shippingEmail}</dd>
            </div>
            <div>
                <dt>Sticker Name:</dt><dd>${stickerName}</dd>
                <dt>Material:</dt><dd>${material}</dd>
            </div>
            <div>
                <dt>Quantity:</dt><dd>${quantity}</dd>
                <dt>Amount:</dt><dd>${escapeHtml(formattedAmount)}</dd>
            </div>
        </div>

        <div class="mt-4">
            <dt>Sticker Design:</dt>
            <a class="sticker-peel-container" href="${designImagePath}" target="_blank">
                <img class="sticker-design" src="${designImagePath}" alt="Sticker Design" data-cut-file-path="${cutFilePath}" data-quantity="${quantity}" loading="lazy" decoding="async">
            </a>
            ${cutFilePath ? `<div class="mt-2"><dt>Cut File:</dt><dd><a href="${serverUrl}${cutFilePath}" class="text-blue-500 underline text-sm" target="_blank" download>Download SVG / XML</a></dd></div>` : ""}
        </div>

        <div class="mt-2 flex flex-wrap gap-2">
            ${dropdownHtml}
        </div>

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

// --- Restored SVG Nesting and File Handling Functionality ---

async function handleSearch() {
  const query = ui.searchInput.value.trim();
  if (!query) {
    fetchAndDisplayOrders(); // Fetch all orders if search is cleared
    return;
  }
  await fetchAndDisplayOrders(query);

  // If Scan Mode is active and we found an order, automatically update it
  if (
    document.getElementById("scan-mode-banner") &&
    !document.getElementById("scan-mode-banner").classList.contains("hidden")
  ) {
    const matchingOrders = allOrders.filter(
      (o) => o.orderId.includes(query) || o.orderId === query,
    );
    if (matchingOrders.length === 1) {
      const targetStatus = document.getElementById("scanTargetStatus").value;
      const orderId = matchingOrders[0].orderId;
      try {
        const response = await fetchWithAuth(
          `${serverUrl}/api/orders/${orderId}/status`,
          {
            method: "POST",
            body: JSON.stringify({ status: targetStatus }),
          },
        );

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

        // Clear input for next scan
        ui.searchInput.value = "";
        ui.searchInput.focus();
      } catch (error) {
        showErrorToast(`Scan Mode Update Failed: ${error.message}`);
      }
    } else if (matchingOrders.length > 1) {
      showErrorToast("Scan Mode: Multiple orders match. Please refine search.");
    } else {
      showErrorToast("Scan Mode: No order found.");
    }
  }
}

let scanBuffer = "";
let scanTimeout;

function handleBarcodeScan(e) {
  if (
    document.getElementById("scan-mode-banner") &&
    !document.getElementById("scan-mode-banner").classList.contains("hidden")
  ) {
    // Only intercept if we are NOT already typing in an input box
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      if (e.key === "Enter") {
        if (scanBuffer.length > 0) {
          ui.searchInput.value = scanBuffer;
          handleSearch();
          scanBuffer = "";
        }
      } else if (e.key.length === 1) {
        // Normal character
        scanBuffer += e.key;
        clearTimeout(scanTimeout);
        // Clear buffer if pause is more than 500ms (not a scanner)
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
  setButtonLoading(btn, true, "Nesting...");
  ui.nestedSvgContainer.innerHTML = "<p>Nesting in progress...</p>";

  // Grab all checked order cards and then find their sticker-design elements
  const checkedCheckboxes = Array.from(
    ui.ordersList.querySelectorAll(".order-select-checkbox:checked"),
  );
  const svgElements = checkedCheckboxes
    .map((cb) => {
      const orderContainer = cb.closest(".order-card, .order-row");
      return orderContainer ? orderContainer.querySelector(".sticker-design") : null;
    })
    .filter((img) => img !== null);

  if (svgElements.length === 0) {
    ui.nestedSvgContainer.innerHTML =
      '<p class="text-red-500 font-bold">Please select at least one order to nest.</p>';
    hideLoadingIndicator();
    return;
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

    // Add internal keep-outs
    const keepoutAreasText = document.getElementById("keepoutAreas").value;
    const keepoutAreas = JSON.parse(keepoutAreasText);
    keepoutAreas.forEach((area) => {
      clip.push([
        { X: area.x * scale, Y: area.y * scale },
        { X: (area.x + area.width) * scale, Y: area.y * scale },
        { X: (area.x + area.width) * scale, Y: (area.y + area.height) * scale },
        { X: area.x * scale, Y: (area.y + area.height) * scale },
      ]);
    });

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
          cutlineSvgText = generateCutFile(svgString);
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
        const width = cutlineRoot.getAttribute("width") || "100%";
        const height = cutlineRoot.getAttribute("height") || "100%";
        let viewBox = cutlineRoot.getAttribute("viewBox");
        if (!viewBox && width !== "100%" && height !== "100%") {
          // fallback if no viewBox
          viewBox = `0 0 ${parseFloat(width)} ${parseFloat(height)}`;
        }

        const availW = binWidth - marginLeft - marginRight;
        const availH = binHeight - marginTop - marginBottom;
        const svgW = parseFloat(width);
        const svgH = parseFloat(height);
        
        if (!isNaN(svgW) && !isNaN(svgH)) {
          const fitsNormal = svgW <= availW && svgH <= availH;
          const fitsRotated = svgW <= availH && svgH <= availW;
          if (!fitsNormal && !fitsRotated) {
            const orderId = img.closest('.order-row, .order-card')?.dataset?.orderId || "unknown";
            throw new Error(`Sticker for order ${orderId.substring(0, 8)} (${Math.round(svgW)}x${Math.round(svgH)}px) is too large for the printable area (${Math.round(availW)}x${Math.round(availH)}px). Please reduce margins or use a larger sheet.`);
          }
        }

        const unifiedSvg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        if (width) unifiedSvg.setAttribute("width", width);
        if (height) unifiedSvg.setAttribute("height", height);
        if (viewBox) unifiedSvg.setAttribute("viewBox", viewBox);

        const group = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        group.setAttribute("class", "nest-group");

        const imageEl = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "image",
        );
        imageEl.setAttribute("href", pngBase64);
        imageEl.setAttribute("width", width);
        imageEl.setAttribute("height", height);

        if (viewBox) {
          const parts = viewBox.split(/[\s,]+/);
          if (parts.length === 4) {
            imageEl.setAttribute("x", parts[0]);
            imageEl.setAttribute("y", parts[1]);
            imageEl.setAttribute("width", parts[2]);
            imageEl.setAttribute("height", parts[3]);
          }
        }

        group.appendChild(imageEl);

        // Add cut lines on top
        Array.from(cutlineRoot.childNodes).forEach((child) => {
          const clone = child.cloneNode(true);
          if (clone.nodeType === 1) { // ELEMENT_NODE
            clone.setAttribute("class", (clone.getAttribute("class") || "") + " cut-line-element");
          }
          group.appendChild(clone);
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
    const addPrintingMarks = ui.addPrintingMarks.checked;
    const options = { 
      spacing, 
      rotations: 4, 
      addPrintingMarks,
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
            rootSvg.appendChild(createMark(135, 60));
            // Top-Right
            rootSvg.appendChild(createMark(binWidth - 135, 60));
            // Bottom-Left
            rootSvg.appendChild(createMark(135, binHeight - 60));
            // Bottom-Right
            rootSvg.appendChild(createMark(binWidth - 135, binHeight - 60));

            if (window.QRCode) {
            try {
                const qrCanvas = document.createElement("canvas");
                await QRCode.toCanvas(qrCanvas, trackingCode, {
                width: 100,
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
                qrImg.setAttribute("width", "100");
                qrImg.setAttribute("height", "100");

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

                // Top-Left QR Code (placed outside fiducial at cx=135, cy=60)
                // QR is placed to the left of the fiducial (X=20). 
                // Text is placed inline to the right of the QR code (X=130).
                addQR(20, 10, 130, 65, "start");
                
                // Bottom-Right QR Code (placed outside fiducial at cx=binWidth-135, cy=binHeight-60)
                // QR is placed to the right of the fiducial (X=binWidth - 120).
                // Text is placed inline to the left of the QR code (X=binWidth - 130).
                addQR(binWidth - 120, binHeight - 110, binWidth - 130, binHeight - 55, "end");
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

  window.nestedSvgs.forEach((nestedSvg, index) => {
      const cutFileString = generateCutFile(nestedSvg);
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

async function handleExportPdf() {
  if (!window.nestedSvgs || window.nestedSvgs.length === 0) {
    showErrorToast("No nested SVG sheets to export.");
    return;
  }

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

        // Remove cut lines and bin outlines for PDF export so we only print the image layer
        // Stickers are PNG <image> tags, fiducials are <circle>/<rect>, QRs are <image>/<text>.
        svgElement.querySelectorAll('path, polygon, polyline, line').forEach(el => el.remove());

        // Target 300 DPI (Default SVG scale is usually 96 DPI)
        const scale = 300 / 96;
        const targetWidth = Math.round(width * scale);
        const targetHeight = Math.round(height * scale);

        // Update SVG dimensions for crisp rendering onto canvas
        svgElement.setAttribute("width", targetWidth);
        svgElement.setAttribute("height", targetHeight);

        // Serialize back to string
        const svgString = new XMLSerializer().serializeToString(svgElement);
        const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);

        // Load into an Image
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
        });

        // Draw to a scaled Canvas with white background
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        URL.revokeObjectURL(url);

        // Get JPEG for PDF
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);

        // Add to PDF
        if (i === 0) {
            // Create the PDF with the correct original dimensions
            doc = new jsPDF({
              unit: "px",
              format: [width, height],
            });
        } else {
            doc.addPage([width, height]);
        }

        doc.addImage(jpegDataUrl, 'JPEG', 0, 0, width, height);

        // Get PNG Blob and add to zip
        const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const sheetSuffix = window.nestedSvgs.length > 1 ? `-sheet${i + 1}` : '';
        zip.file(`${baseName}${sheetSuffix}-300dpi.png`, pngBlob);
    }

    // Add PDF to zip
    const pdfBlob = doc.output('blob');
    zip.file(`${baseName}-300dpi.pdf`, pdfBlob);

    // Generate zip and trigger download
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
    "save-general-settings-btn"
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

  if (scanModeBtn) {
    scanModeBtn.addEventListener("click", () => {
      scanModeBanner.classList.remove("hidden");
      ui.searchInput.focus();
    });
  }

  if (closeScanModeBtn) {
    closeScanModeBtn.addEventListener("click", () => {
      scanModeBanner.classList.add("hidden");
    });
  }

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
    });
  }

  // Odoo listeners
  document
    .getElementById("odoo-config-form")
    ?.addEventListener("submit", saveOdooConfig);
  document
    .getElementById("test-odoo-btn")
    ?.addEventListener("click", testOdooConnection);

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
let currentPricingConfig = {};

async function loadPricingConfigEditor() {
  if (!ui.pricingEditorContainer) return;
  ui.pricingEditorContainer.innerHTML =
    '<p class="text-gray-500 text-center py-4">Loading pricing configuration...</p>';
  try {
    const config = await fetchWithAuth(`${serverUrl}/api/pricing-info`);
    currentPricingConfig = config;
    renderPricingEditor(currentPricingConfig);
  } catch (err) {
    ui.pricingEditorContainer.innerHTML = `<p class="text-red-500 text-center py-4">Error loading pricing: ${err.message}</p>`;
  }
}

function renderPricingEditor(config) {
  if (!ui.pricingEditorContainer) return;

  const resolutions = config.resolutions || [];
  const materials = config.materials || [];
  const layers = config.layers || [];
  const complexity = config.complexity || { perLayerMultiplier: 0.1, tiers: [] };
  const quantityDiscounts = config.quantityDiscounts || [];

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

        <!-- Simulator Results Box -->
        <div class="bg-white p-4 rounded-lg border border-indigo-200 flex flex-wrap justify-between items-center gap-4">
          <div class="space-y-1">
            <div class="text-xs text-gray-500">Square Inches: <span id="sim-out-sqin" class="font-bold text-gray-800">9.0</span> sq in</div>
            <div class="text-xs text-gray-500">Combined Multipliers: <span id="sim-out-mult" class="font-bold text-indigo-600">1.30x</span></div>
            <div class="text-xs text-gray-500">Volume Discount: <span id="sim-out-disc" class="font-bold text-green-600">0% OFF</span></div>
          </div>
          <div class="text-right">
            <div class="text-xs text-gray-400 uppercase font-bold tracking-wide">Calculated Total:</div>
            <div id="sim-out-total" class="text-2xl sm:text-3xl font-extrabold text-splotch-navy">$0.00</div>
            <div id="sim-out-unit" class="text-xs text-gray-500">($0.00 / sticker)</div>
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

  // Delegate event for all remove buttons and dynamic badges
  ui.pricingEditorContainer.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-row-btn")) {
      const row =
        e.target.closest(".layer-row") ||
        e.target.closest(".material-row") ||
        e.target.closest(".resolution-row") ||
        e.target.closest(".complexity-row") ||
        e.target.closest(".discount-row") ||
        e.target.parentElement;
      if (row) row.remove();
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

  updateSimulatorDropdowns();
  runSimulator();
}

function updateSimulatorDropdowns() {
  const matSelect = document.getElementById("sim-mat");
  const resSelect = document.getElementById("sim-res");
  if (!matSelect || !resSelect) return;

  const currentMat = matSelect.value;
  const currentRes = resSelect.value;

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

function runSimulator() {
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
  const totalCents = Math.round(
    totalCentsBeforeDiscount * (1 - discountPercent)
  );

  const totalDollars = (totalCents / 100).toFixed(2);
  const unitDollars = ((totalCents / qty) / 100).toFixed(2);

  // Update simulator UI
  const outSqIn = document.getElementById("sim-out-sqin");
  const outMult = document.getElementById("sim-out-mult");
  const outDisc = document.getElementById("sim-out-disc");
  const outTotal = document.getElementById("sim-out-total");
  const outUnit = document.getElementById("sim-out-unit");

  if (outSqIn) outSqIn.textContent = sqInches.toFixed(1);
  if (outMult) outMult.textContent = `${combinedMultiplier.toFixed(2)}x`;
  if (outDisc)
    outDisc.textContent = `${Math.round(discountPercent * 100)}% OFF`;
  if (outTotal) outTotal.textContent = `$${totalDollars}`;
  if (outUnit) outUnit.textContent = `($${unitDollars} / sticker)`;
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
