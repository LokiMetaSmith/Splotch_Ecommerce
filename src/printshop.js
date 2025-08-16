// printshop.js
import '/src/styles.css'; // Or your main CSS file
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import DOMPurify from 'dompurify';
import { SvgNest } from './lib/svgnest.js';
import { SVGParser } from './lib/svgparser.js';
import * as jose from 'jose';
import { jsPDF } from "jspdf";
import SVGtoPDF from 'svg-to-pdfkit';

// --- Global Variables ---
const serverUrl = 'http://localhost:3000';
let authToken = localStorage.getItem('authToken');
let csrfToken;
let allOrders = []; // To store a complete list of orders for filtering
let JWKS; // To hold the remote key set verifier

// --- DOM Elements ---
// A single object to hold all DOM elements for cleaner management
const ui = {};

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
    dot.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500');

    switch (status) {
        case 'connected':
            dot.classList.add('bg-green-500');
            text.textContent = 'Connected';
            break;
        case 'error':
            dot.classList.add('bg-red-500');
            text.textContent = 'Error';
            break;
        case 'connecting':
            dot.classList.add('bg-yellow-500');
            text.textContent = 'Connecting...';
            break;
        default: // idle
            dot.classList.add('bg-yellow-500');
            text.textContent = 'Status';
            break;
    }
}


/**
 * Encodes an ArrayBuffer into a Base64URL string.
 * @param {ArrayBuffer} value The buffer to encode.
 * @returns {string} The encoded string.
 */
function bufferEncode(value) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

// The final fetchWithAuth function with robust verification
async function fetchWithAuth(url, options = {}) {
    if (!JWKS) {
        throw new Error("Cannot make requests: JWKS verifier is not available.");
    }

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    // Add CSRF token for state-changing requests
    if (options.method && options.method !== 'GET') {
        headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(url, { ...options, headers, credentials: 'include' });

    const storedToken = localStorage.getItem('serverSessionToken');
    const liveToken = response.headers.get('X-Server-Session-Token');

    if (liveToken && storedToken && liveToken !== storedToken) {
        console.warn('New server session token detected. Verifying signature...');
        try {
            // Verify the new token. `jose` automatically uses the `kid` from the
            // token header to find the correct key in the remote JWKS set.
            await jose.jwtVerify(liveToken, JWKS);

            console.log('New token is valid. Server has restarted or rotated keys. Refreshing.');
            localStorage.setItem('serverSessionToken', liveToken);

            localStorage.removeItem('authToken'); // Clear user auth token
            window.location.reload();
            throw new Error("Server restarted.");

        } catch (err) {
            console.error('CRITICAL SECURITY ALERT: Invalid server session token signature! Halting.', err);
            showErrorToast('Security Alert: Server identity mismatch. Disconnecting.');
            throw new Error("Invalid server token signature.");
        }
    }

    if (response.status === 401) {
        logout(); // Token is invalid/expired, log out user
        showErrorToast('Session expired. Please log in again.');
        throw new Error('Authentication failed');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'An unknown server error occurred.' }));
        throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
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
    localStorage.setItem('authToken', token);

    ui.authStatus.textContent = `Welcome, ${username}!`;
    ui.loginBtn.textContent = 'Log Out';
    ui.registerBtn.style.display = 'block'; // Show registration button for admins

    // Clear and attach the correct event listener
    ui.loginBtn.removeEventListener('click', showLoginModal);
    ui.loginBtn.addEventListener('click', logout);

    hideLoginModal();
    fetchAndDisplayOrders();
}

/**
 * Sets the application to a logged-out state.
 */
function logout() {
    authToken = null;
    localStorage.removeItem('authToken');

    ui.authStatus.textContent = '';
    ui.loginBtn.textContent = 'Login';
    ui.registerBtn.style.display = 'none';

    // Clear and attach the correct event listener
    ui.loginBtn.removeEventListener('click', logout);
    ui.loginBtn.addEventListener('click', showLoginModal);

    ui.ordersList.innerHTML = '';
    ui.noOrdersMessage.textContent = 'Please log in to view orders.';
    ui.noOrdersMessage.style.display = 'block';
}

/**
 * Handles the WebAuthn (YubiKey) login flow.
 */
async function handleWebAuthnLogin() {
    const username = ui.usernameInput.value;
    if (!username) {
        showErrorToast('Please enter your username.');
        return;
    }

    showLoadingIndicator();
    try {
        const opts = await fetchWithAuth(`${serverUrl}/api/auth/login-options?username=${encodeURIComponent(username)}`);

        if (opts.allowCredentials && opts.allowCredentials.length === 0) {
            hideLoadingIndicator();
            showErrorToast('No security key registered for this user. Please register a key first.');
            return;
        }

        const authResp = await startAuthentication(opts);
        
        // Encode binary data to Base64URL before sending to server
        const verificationPayload = {
            username,
            id: authResp.id,
            rawId: bufferEncode(authResp.rawId),
            type: authResp.type,
            response: {
                clientDataJSON: bufferEncode(authResp.response.clientDataJSON),
                authenticatorData: bufferEncode(authResp.response.authenticatorData),
                signature: bufferEncode(authResp.response.signature),
                userHandle: authResp.response.userHandle ? bufferEncode(authResp.response.userHandle) : null,
            },
        };

        const verification = await fetchWithAuth(`${serverUrl}/api/auth/login-verify`, {
            method: 'POST',
            body: JSON.stringify(verificationPayload),
        });

        if (verification.verified) {
            setLoggedInState(verification.token, username);
            showSuccessToast('Successfully logged in with Security Key!');
        } else {
            throw new Error(verification.error || 'WebAuthn verification failed.');
        }
    } catch (error) {
        showErrorToast(`WebAuthn Login Failed: ${error.message}`);
        console.error(error);
    } finally {
        hideLoadingIndicator();
    }
}

/**
 * Handles the password login flow.
 */
async function handlePasswordLogin() {
    const username = ui.usernameInput.value;
    const password = ui.passwordInput.value;

    if (!username || !password) {
        showErrorToast('Username and password are required.');
        return;
    }

    showLoadingIndicator();
    try {
        const data = await fetchWithAuth(`${serverUrl}/api/auth/login`, {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });

        if (data.token) {
            setLoggedInState(data.token, username);
            showSuccessToast('Login successful!');
        } else {
            throw new Error('Password verification failed.');
        }
    } catch (error) {
        showErrorToast(`Password Login Failed: ${error.message}`);
        console.error(error);
    } finally {
        hideLoadingIndicator();
    }
}

/**
 * Handles the registration of a new WebAuthn credential.
 */
async function handleRegistration() {
    const username = ui.usernameInput.value;
    if (!username) {
        showErrorToast('Please enter a username to register a key.');
        return;
    }

    showLoadingIndicator();
    try {
        const opts = await fetchWithAuth(`${serverUrl}/api/auth/pre-register`, {
            method: 'POST',
            body: JSON.stringify({ username }),
        });
        const regResp = await startRegistration(opts);
        
        // Encode binary data before sending for verification
        const verificationPayload = {
            username,
            id: regResp.id,
            rawId: bufferEncode(regResp.rawId),
            type: regResp.type,
            response: {
                clientDataJSON: bufferEncode(regResp.response.clientDataJSON),
                attestationObject: bufferEncode(regResp.response.attestationObject),
            },
        };
        
        const verification = await fetchWithAuth(`${serverUrl}/api/auth/register-verify`, {
            method: 'POST',
            body: JSON.stringify(verificationPayload),
        });

        if (verification.verified) {
            showSuccessToast('Security Key registered successfully!');
        } else {
            throw new Error(verification.error || 'Registration failed.');
        }
    } catch (error) {
        showErrorToast(`Registration Failed: ${error.message}`);
        console.error(error);
    } finally {
        hideLoadingIndicator();
    }
}

// --- UI Functions ---

function showLoginModal() { ui.loginModal?.classList.remove('hidden'); }
function hideLoginModal() { ui.loginModal?.classList.add('hidden'); }
function showLoadingIndicator() { ui.loadingIndicator?.classList.remove('hidden'); }
function hideLoadingIndicator() { ui.loadingIndicator?.classList.add('hidden'); }
function showErrorToast(message) {
    ui.errorMessage.textContent = message;
    ui.errorToast.classList.remove('hidden');
    setTimeout(hideErrorToast, 5000);
}
function hideErrorToast() { ui.errorToast?.classList.add('hidden'); }
function showSuccessToast(message) {
    ui.successMessage.textContent = message;
    ui.successToast.classList.remove('hidden');
    setTimeout(hideSuccessToast, 3000);
}
function hideSuccessToast() { ui.successToast?.classList.add('hidden'); }


// --- Application Logic ---

async function fetchAndDisplayOrders(query = '') {
    if (!authToken) {
        ui.noOrdersMessage.textContent = 'Please log in to view orders.';
        updateConnectionStatus('idle');
        return;
    }
    showLoadingIndicator();
    updateConnectionStatus('connecting');
    ui.noOrdersMessage.textContent = 'Loading orders...';
    ui.noOrdersMessage.style.display = 'block';

    try {
        const endpoint = query ? `${serverUrl}/api/orders/search?q=${encodeURIComponent(query)}` : `${serverUrl}/api/orders`;
        allOrders = await fetchWithAuth(endpoint);
        // After fetching, display with the current filter (defaults to ALL)
        const activeFilter = document.querySelector('#filter-container .filter-btn.active')?.dataset.status || 'ALL';
        filterAndDisplayOrders(activeFilter);

        updateConnectionStatus('connected');
    } catch (error) {
        console.error('[SHOP] Error fetching orders:', error);
        updateConnectionStatus('error');
        // Error is already shown by fetchWithAuth on 401, this handles other network errors
        if (error.message !== 'Authentication failed') {
           showErrorToast(`Could not fetch orders: ${error.message}`);
        }
    } finally {
        hideLoadingIndicator();
    }
}

/**
 * Filters the global `allOrders` array and renders the matching orders.
 * @param {string} status - The status to filter by (e.g., 'NEW', 'ALL').
 */
function filterAndDisplayOrders(status) {
    ui.ordersList.innerHTML = ''; // Clear the current list

    const ordersToDisplay = (status === 'ALL')
        ? allOrders
        : allOrders.filter(order => order.status === status);

    if (ordersToDisplay.length === 0) {
        ui.noOrdersMessage.textContent = `No orders found with status: ${status}.`;
        ui.noOrdersMessage.style.display = 'block';
    } else {
        ui.noOrdersMessage.style.display = 'none';
        ordersToDisplay.forEach(displayOrder);
    }
}

/**
 * Renders a single order card into the DOM.
 * @param {object} order - The order object from the server.
 */
function displayOrder(order) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.id = `order-card-${order.orderId}`;

    const formattedAmount = order.amount ? `$${(order.amount / 100).toFixed(2)}` : 'N/A';
    const receivedDate = new Date(order.receivedAt).toLocaleString();

    card.innerHTML = DOMPurify.sanitize(`
        <div class="flex justify-between items-start">
            <div>
                <h3 class="text-xl text-splotch-red">Order ID: <span class="font-mono text-sm">${order.orderId.substring(0, 8)}...</span></h3>
                <p class="text-sm text-gray-600">Received: ${receivedDate}</p>
            </div>
            <div id="status-badge-${order.orderId}" class="status-${order.status.toLowerCase()} font-bold py-1 px-3 rounded-full text-sm">${order.status}</div>
        </div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 order-details">
            <div>
                <dt>Billing Name:</dt> <dd>${order.billingContact?.givenName || ''} ${order.billingContact?.familyName || ''}</dd>
                <dt>Billing Email:</dt> <dd>${order.billingContact?.email || 'N/A'}</dd>
            </div>
            <div>
                <dt>Shipping Name:</dt> <dd>${order.shippingContact?.givenName || ''} ${order.shippingContact?.familyName || ''}</dd>
                <dt>Shipping Email:</dt> <dd>${order.shippingContact?.email || 'N/A'}</dd>
            </div>
            <div>
                <dt>Quantity:</dt> <dd>${order.orderDetails?.quantity || 'N/A'}</dd>
                <dt>Amount:</dt> <dd>${formattedAmount}</dd>
            </div>
        </div>
        <div class="mt-4">
            <dt>Sticker Design:</dt>
            <a href="${serverUrl}${order.designImagePath}" target="_blank"><img src="${serverUrl}${order.designImagePath}" alt="Sticker Design" class="sticker-design" data-cut-file-path="${order.cutLinePath || ''}"></a>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
            <button class="action-btn" data-order-id="${order.orderId}" data-status="ACCEPTED">Accept</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="PRINTING">Print</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="SHIPPED">Ship</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="DELIVERED">Deliver</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="COMPLETED">Complete</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="CANCELED">Cancel</button>
        </div>`);

    ui.ordersList.prepend(card);

    card.querySelectorAll('.action-btn').forEach(btn => {
      //  btn.addEventListener('click', (e) => updateOrderStatus(e.target.dataset.orderId, e.target.dataset.status));
		btn.addEventListener('click', (e) => {
            const orderId = e.target.dataset.orderId;
            const status = e.target.dataset.status;
            // This function calls your server to update the status
            updateOrderStatus(orderId, status);
        });
    });
}

/**
 * Sends a request to the server to update an order's status.
 * @param {string} orderId The ID of the order to update.
 * @param {string} newStatus The new status for the order.
 */
async function updateOrderStatus(orderId, newStatus) {
    showLoadingIndicator();
    try {
        const updatedOrder = await fetchWithAuth(`${serverUrl}/api/orders/${orderId}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: newStatus }),
        });

        // Update the order in our local cache
        const orderIndex = allOrders.findIndex(o => o.orderId === orderId);
        if (orderIndex !== -1) {
            allOrders[orderIndex].status = newStatus;
        }

        showSuccessToast(`Order status updated to ${newStatus}.`);

        // Re-filter the list to reflect the change
        const activeFilter = document.querySelector('#filter-container .filter-btn.active')?.dataset.status || 'ALL';
        filterAndDisplayOrders(activeFilter);

    } catch (error) {
        showErrorToast(`Update Failed: ${error.message}`);
        console.error(error);
    } finally {
        hideLoadingIndicator();
    }
}

// --- Restored SVG Nesting and File Handling Functionality ---

async function handleSearch() {
    const query = ui.searchInput.value.trim();
    if (!query) {
        fetchAndDisplayOrders(); // Fetch all orders if search is cleared
        return;
    }
    fetchAndDisplayOrders(query);
}

async function handleNesting() {
    showLoadingIndicator();
    ui.nestedSvgContainer.innerHTML = '<p>Nesting in progress...</p>';

    const svgElements = Array.from(ui.ordersList.querySelectorAll('.sticker-design'));
    if (svgElements.length === 0) {
        ui.nestedSvgContainer.innerHTML = '<p>No designs to nest.</p>';
        hideLoadingIndicator();
        return;
    }

    try {
        // 1. Generate the complex bin polygon
        const binWidth = 12 * 96; // 12 inches
        const binHeight = 12 * 96; // 12 inches
        const scale = 10000; // Use a high scale for precision

        const cpr = new ClipperLib.Clipper();
        const subj = [{ X: 0, Y: 0 }, { X: binWidth * scale, Y: 0 }, { X: binWidth * scale, Y: binHeight * scale }, { X: 0, Y: binHeight * scale }];
        cpr.AddPath(subj, ClipperLib.PolyType.ptSubject, true);

        const clip = [];
        // Add edge margins
        const marginTop = parseInt(document.getElementById('marginTop').value, 10) || 0;
        const marginBottom = parseInt(document.getElementById('marginBottom').value, 10) || 0;
        const marginLeft = parseInt(document.getElementById('marginLeft').value, 10) || 0;
        const marginRight = parseInt(document.getElementById('marginRight').value, 10) || 0;

        // Top margin as a keep-out
        clip.push([{ X: -10, Y: -10 }, { X: (binWidth + 10) * scale, Y: -10 }, { X: (binWidth + 10) * scale, Y: marginTop * scale }, { X: -10, Y: marginTop * scale }]);
        // Bottom margin
        clip.push([{ X: -10, Y: (binHeight - marginBottom) * scale }, { X: (binWidth + 10) * scale, Y: (binHeight - marginBottom) * scale }, { X: (binWidth + 10) * scale, Y: (binHeight + 10) * scale }, { X: -10, Y: (binHeight + 10) * scale }]);
        // Left margin
        clip.push([{ X: -10, Y: -10 }, { X: marginLeft * scale, Y: -10 }, { X: marginLeft * scale, Y: (binHeight + 10) * scale }, { X: -10, Y: (binHeight + 10) * scale }]);
        // Right margin
        clip.push([{ X: (binWidth - marginRight) * scale, Y: -10 }, { X: (binWidth + 10) * scale, Y: -10 }, { X: (binWidth + 10) * scale, Y: (binHeight + 10) * scale }, { X: (binWidth - marginRight) * scale, Y: (binHeight + 10) * scale }]);

        // Add internal keep-outs
        const keepoutAreasText = document.getElementById('keepoutAreas').value;
        const keepoutAreas = JSON.parse(keepoutAreasText);
        keepoutAreas.forEach(area => {
            clip.push([
                { X: area.x * scale, Y: area.y * scale },
                { X: (area.x + area.width) * scale, Y: area.y * scale },
                { X: (area.x + area.width) * scale, Y: (area.y + area.height) * scale },
                { X: area.x * scale, Y: (area.y + area.height) * scale }
            ]);
        });

        cpr.AddPaths(clip, ClipperLib.PolyType.ptClip, true);

        const solution = new ClipperLib.Paths();
        cpr.Execute(ClipperLib.ClipType.ctDifference, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

        const complexBinPolygon = solution[0].map(p => ({ x: p.X / scale, y: p.Y / scale }));

        // 2. Fetch and prepare the sticker SVGs
        const svgPromises = svgElements.map(async (img) => {
            const cutFilePath = img.dataset.cutFilePath;
            if (cutFilePath) {
                return (await fetch(`${serverUrl}${cutFilePath}`, { credentials: 'include' })).text();
            } else {
                const svgString = await (await fetch(img.src, { credentials: 'include' })).text();
                return generateCutFile(svgString);
            }
        });
        const svgStrings = await Promise.all(svgPromises);

        // 3. Set up and run SVGNest
        const parser = new SVGParser();
        const svgs = svgStrings.map(s => parser.load(s));

        const spacing = parseInt(ui.spacingInput.value, 10) || 0;
        const options = { spacing, rotations: 4 };

        const nest = new SVGNest(null, svgs, options); // Pass null for binElement
        nest.setBinPolygon(complexBinPolygon); // Use the new method

        const resultSvg = nest.start();

        // 4. Display result
        ui.nestedSvgContainer.innerHTML = resultSvg;
        window.nestedSvg = resultSvg;
        showSuccessToast('Nesting complete.');

    } catch (error) {
        showErrorToast(`Nesting failed: ${error.message}`);
        console.error(error);
    } finally {
        hideLoadingIndicator();
    }
}

function generateCutFile(svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = doc.documentElement;
    const cutFileSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cutFileSvg.setAttribute('width', svgElement.getAttribute('width'));
    cutFileSvg.setAttribute('height', svgElement.getAttribute('height'));
    cutFileSvg.setAttribute('viewBox', svgElement.getAttribute('viewBox'));

    svgElement.querySelectorAll('path').forEach(path => {
        const newPath = path.cloneNode();
        newPath.setAttribute('stroke', 'red');
        newPath.setAttribute('fill', 'none');
        cutFileSvg.appendChild(newPath);
    });

    return new XMLSerializer().serializeToString(cutFileSvg);
}

function handleDownloadCutFile() {
    if (!window.nestedSvg) {
        showErrorToast('No nested SVG to generate a cut file from.');
        return;
    }

    const cutFileString = generateCutFile(window.nestedSvg);
    const blob = new Blob([cutFileString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cut-file.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleExportPdf() {
    if (!window.nestedSvg) {
        showErrorToast('No nested SVG to export.');
        return;
    }

    try {
        const doc = new jsPDF({
            unit: 'px',
            format: 'a4'
        });

        const svgElement = new DOMParser().parseFromString(window.nestedSvg, "image/svg+xml").documentElement;

        const width = parseFloat(svgElement.getAttribute('width'));
        const height = parseFloat(svgElement.getAttribute('height'));

        doc.deletePage(1);
        doc.addPage([width, height]);

        SVGtoPDF(doc, svgElement, 0, 0);

        doc.save('nested-stickers.pdf');
        showSuccessToast('PDF exported successfully.');
    } catch (error) {
        showErrorToast(`PDF Export Failed: ${error.message}`);
        console.error(error);
    }
}


// --- Initialization ---
async function getServerSessionToken() {
    try {
        const response = await fetch(`${serverUrl}/api/server-info`, { credentials: 'include' });
        const { serverSessionToken } = await response.json();
        localStorage.setItem('serverSessionToken', serverSessionToken);
        console.log('[CLIENT] Initial server session token acquired.');
    } catch (error) {
        console.error('Could not acquire server session token.', error);
    }
}

/**
 * Verifies the current token with the server to ensure it's still valid.
 */
async function verifyInitialToken() {
    if (!authToken) {
        updateConnectionStatus('idle');
        return false;
    }

    updateConnectionStatus('connecting');
    try {
        // This endpoint should return user info if the token is valid, and 401 if not.
        const data = await fetchWithAuth(`${serverUrl}/api/auth/verify-token`);
        if (data.username) {
            setLoggedInState(authToken, data.username);
            // fetchAndDisplayOrders will set the final 'connected' status
            return true;
        }
        updateConnectionStatus('error');
        return false;
    } catch (error) {
        updateConnectionStatus('error');
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
        const response = await fetch(`${serverUrl}/api/csrf-token`, { credentials: 'include' });
        const data = await response.json();
        csrfToken = data.csrfToken;
    } catch (error) {
        console.error('Fatal: Could not fetch CSRF token. App may not function correctly.', error);
        showErrorToast('Could not establish a secure session with the server.');
    }
}

/**
 * Main application entry point.
 */
async function init() {
    // This creates a verifier that automatically fetches and caches keys from your JWKS endpoint
    JWKS = jose.createRemoteJWKSet(new URL(`${serverUrl}/.well-known/jwks.json`));
    console.log('[CLIENT] Remote JWKS verifier created.');

    await getServerSessionToken();

    // Assign all DOM elements to the ui object
    const ids = ['orders-list', 'no-orders-message', 'refreshOrdersBtn', 'nestStickersBtn', 'nested-svg-container', 'spacingInput', 'registerBtn', 'loginBtn', 'auth-status', 'loading-indicator', 'error-toast', 'error-message', 'close-error-toast', 'success-toast', 'success-message', 'close-success-toast', 'searchInput', 'searchBtn', 'downloadCutFileBtn', 'exportPdfBtn', 'login-modal', 'close-modal-btn', 'username-input', 'password-input', 'password-login-btn', 'webauthn-login-btn', 'webauthn-register-btn', 'connection-status-dot', 'connection-status-text'];
    ids.forEach(id => {
        // Convert kebab-case to camelCase for keys
        const key = id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase());
        ui[key] = document.getElementById(id);
    });

    await getCsrfToken();

    // Attach event listeners
    ui.refreshOrdersBtn?.addEventListener('click', () => fetchAndDisplayOrders());
    ui.registerBtn?.addEventListener('click', handleRegistration);
    ui.closeErrorToast?.addEventListener('click', hideErrorToast);
    ui.closeSuccessToast?.addEventListener('click', hideSuccessToast);
    ui.nestStickersBtn?.addEventListener('click', handleNesting);
    ui.downloadCutFileBtn?.addEventListener('click', handleDownloadCutFile);
    ui.exportPdfBtn?.addEventListener('click', handleExportPdf);
    ui.searchBtn?.addEventListener('click', handleSearch);
    ui.searchInput?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Login Modal Listeners
    ui.closeModalBtn?.addEventListener('click', hideLoginModal);
    ui.passwordLoginBtn?.addEventListener('click', handlePasswordLogin);
    ui.webauthnLoginBtn?.addEventListener('click', handleWebAuthnLogin);
    ui.webauthnRegisterBtn?.addEventListener('click', handleRegistration);


    // The main login button opens the modal
    ui.loginBtn?.addEventListener('click', showLoginModal);

    // Filter button logic
    const filterContainer = document.getElementById('filter-container');
    filterContainer?.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            // Remove active class from all buttons
            filterContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            // Add active class to the clicked button
            e.target.classList.add('active');
            // Actually filter the orders
            const status = e.target.dataset.status;
            filterAndDisplayOrders(status);
        }
    });

    // Check for a token in the URL from OAuth redirect
    const urlParams = new URLSearchParams(window.location.search);
    const oauthToken = urlParams.get('token');
    if (oauthToken) {
        // We got a token from the OAuth redirect. Use it to log in.
        // The token is already verified by the server, but we call verifyInitialToken
        // to fetch user info and set the UI state correctly.
        localStorage.setItem('authToken', oauthToken);
        await verifyInitialToken();
        // Clean the token from the URL
        window.history.replaceState({}, document.title, "/printshop.html");
    } else {
        // Standard token check
        if (!(await verifyInitialToken())) {
            logout();
        }
    }
}

document.addEventListener('DOMContentLoaded', init);