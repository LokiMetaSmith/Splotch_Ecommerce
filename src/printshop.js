// printshop.js
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import DOMPurify from 'dompurify';
import SVGNest from './lib/svgnest.js';
import SVGParser from './lib/svgparser.js';
import * as jose from 'jose';

// --- Global Variables ---
const serverUrl = 'http://localhost:3000';
let authToken = localStorage.getItem('authToken');
let csrfToken;
let JWKS; // To hold the remote key set verifier

// --- DOM Elements ---
// A single object to hold all DOM elements for cleaner management
const ui = {};

// --- Helper Functions ---

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

    const response = await fetch(url, { ...options, headers });

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
    ui.loginBtn.removeEventListener('click', handleWebAuthnLogin);
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

    ui.authStatus.textContent = 'You are logged out.';
    ui.loginBtn.textContent = 'Login with YubiKey';
    ui.registerBtn.style.display = 'none';

    // Clear and attach the correct event listener
    ui.loginBtn.removeEventListener('click', logout);
    ui.loginBtn.addEventListener('click', handleWebAuthnLogin);

    ui.ordersList.innerHTML = '';
    ui.noOrdersMessage.textContent = 'Please log in to view orders.';
    ui.noOrdersMessage.style.display = 'block';
}

/**
 * Handles the WebAuthn (YubiKey) login flow.
 */
async function handleWebAuthnLogin() {
    const username = prompt("Please enter your username:");
    if (!username) return;

    showLoadingIndicator();
    try {
        const opts = await fetchWithAuth(`${serverUrl}/api/auth/login-options?username=${encodeURIComponent(username)}`);
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
        const verification = await fetchWithAuth(`${serverUrl}/api/auth/login-password`, {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });

        if (verification.verified) {
            setLoggedInState(verification.token, username);
            showSuccessToast('Login successful!');
        } else {
            throw new Error(verification.error || 'Password verification failed.');
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
    const username = prompt("Enter username for the new key:");
    if (!username) return;

    showLoadingIndicator();
    try {
        const opts = await fetchWithAuth(`${serverUrl}/api/auth/register-options?username=${encodeURIComponent(username)}`);
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
        return;
    }
    showLoadingIndicator();
    ui.noOrdersMessage.textContent = 'Loading orders...';
    ui.noOrdersMessage.style.display = 'block';
    ui.ordersList.innerHTML = '';

    try {
        const endpoint = query ? `${serverUrl}/api/orders/search?q=${encodeURIComponent(query)}` : `${serverUrl}/api/orders`;
        const orders = await fetchWithAuth(endpoint);
        if (orders.length === 0) {
            ui.noOrdersMessage.textContent = 'No orders found.';
        } else {
            ui.noOrdersMessage.style.display = 'none';
            orders.forEach(displayOrder);
        }
    } catch (error) {
        console.error('[SHOP] Error fetching orders:', error);
        // Error is already shown by fetchWithAuth on 401, this handles other network errors
        if (error.message !== 'Authentication failed') {
           showErrorToast(`Could not fetch orders: ${error.message}`);
        }
    } finally {
        hideLoadingIndicator();
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
                <dt>Name:</dt> <dd>${order.billingContact?.givenName || ''} ${order.billingContact?.familyName || ''}</dd>
                <dt>Email:</dt> <dd>${order.billingContact?.email || 'N/A'}</dd>
            </div>
            <div>
                <dt>Quantity:</dt> <dd>${order.orderDetails?.quantity || 'N/A'}</dd>
                <dt>Amount:</dt> <dd>${formattedAmount}</dd>
            </div>
        </div>
        <div class="mt-4">
            <dt>Sticker Design:</dt>
            <a href="${serverUrl}${order.designImagePath}" target="_blank"><img src="${serverUrl}${order.designImagePath}" alt="Sticker Design" class="sticker-design"></a>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
            <button class="action-btn" data-order-id="${order.orderId}" data-status="ACCEPTED">Accept</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="PRINTING">Print</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="SHIPPED">Ship</button>
            <button class="action-btn" data-order-id="${order.orderId}" data-status="CANCELED">Cancel</button>
        </div>`);

    ui.ordersList.prepend(card);

    card.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => updateOrderStatus(e.target.dataset.orderId, e.target.dataset.status));
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
        await fetchWithAuth(`${serverUrl}/api/orders/${orderId}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: newStatus }),
        });

        showSuccessToast(`Order status updated to ${newStatus}.`);
        const statusBadgeEl = document.getElementById(`status-badge-${orderId}`);
        if (statusBadgeEl) {
            statusBadgeEl.className = `status-${newStatus.toLowerCase()} font-bold py-1 px-3 rounded-full text-sm`;
            statusBadgeEl.textContent = newStatus;
        }
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
    const svgUrls = Array.from(ui.ordersList.querySelectorAll('.sticker-design')).map(img => img.src);
    if (svgUrls.length === 0) {
        ui.nestedSvgContainer.innerHTML = '<p>No designs to nest.</p>';
        hideLoadingIndicator();
        return;
    }

    try {
        const svgStrings = await Promise.all(svgUrls.map(url => fetch(url).then(res => res.text())));
        const binWidth = 12 * 96;
        const binHeight = 12 * 96;
        const binSvg = `<svg width="${binWidth}" height="${binHeight}"><rect x="0" y="0" width="${binWidth}" height="${binHeight}" fill="none" stroke="blue" stroke-width="2"/></svg>`;

        const parser = new SVGParser();
        const svgs = svgStrings.map(s => parser.load(s));
        const bin = parser.load(binSvg);

        const spacing = parseInt(ui.spacingInput.value, 10) || 0;
        const options = { spacing, rotations: 4 };
        const nest = new SVGNest(bin, svgs, options);
        const resultSvg = nest.start();

        ui.nestedSvgContainer.innerHTML = resultSvg;
        window.nestedSvg = resultSvg; // Store for download
        showSuccessToast('Nesting complete.');
    } catch (error) {
        showErrorToast(`Nesting failed: ${error.message}`);
    } finally {
        hideLoadingIndicator();
    }
}

function handleDownloadCutFile() {
    if (!window.nestedSvg) {
        showErrorToast('No nested SVG to generate a cut file from.');
        return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(window.nestedSvg, 'image/svg+xml');
    const nestedSvgElement = doc.documentElement;
    const cutFileSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cutFileSvg.setAttribute('width', nestedSvgElement.getAttribute('width'));
    cutFileSvg.setAttribute('height', nestedSvgElement.getAttribute('height'));
    cutFileSvg.setAttribute('viewBox', nestedSvgElement.getAttribute('viewBox'));

    nestedSvgElement.querySelectorAll('path').forEach(path => {
        const newPath = path.cloneNode();
        newPath.setAttribute('stroke', 'red');
        newPath.setAttribute('fill', 'none');
        cutFileSvg.appendChild(newPath);
    });

    const svgString = new XMLSerializer().serializeToString(cutFileSvg);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cut-file.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


// --- Initialization ---
async function getServerSessionToken() {
    try {
        const { serverSessionToken } = await fetch(`${serverUrl}/api/server-info`).then(res => res.json());
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
    if (!authToken) return false;

    try {
        // This endpoint should return user info if the token is valid, and 401 if not.
        const data = await fetchWithAuth(`${serverUrl}/api/auth/verify-token`);
        if (data.username) {
            setLoggedInState(authToken, data.username);
            return true;
        }
        return false;
    } catch (error) {
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
        const data = await fetch(`${serverUrl}/api/csrf-token`).then(res => res.json());
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
    const ids = ['orders-list', 'no-orders-message', 'refreshOrdersBtn', 'nestStickersBtn', 'nested-svg-container', 'spacingInput', 'registerBtn', 'loginBtn', 'auth-status', 'loading-indicator', 'error-toast', 'error-message', 'close-error-toast', 'success-toast', 'success-message', 'close-success-toast', 'searchInput', 'searchBtn', 'downloadCutFileBtn', 'login-modal', 'close-modal-btn', 'username-input', 'password-input', 'password-login-btn', 'webauthn-login-btn'];
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
    ui.searchBtn?.addEventListener('click', handleSearch);
    ui.searchInput?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Login Modal Listeners
    ui.closeModalBtn?.addEventListener('click', hideLoginModal);
    ui.passwordLoginBtn?.addEventListener('click', handlePasswordLogin);

    // The main login button is for WebAuthn
    ui.loginBtn?.addEventListener('click', handleWebAuthnLogin);

    // Check initial authentication state
    if (!(await verifyInitialToken())) {
        logout();
    }
}

document.addEventListener('DOMContentLoaded', init);