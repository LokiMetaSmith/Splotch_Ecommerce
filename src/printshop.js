// printshop.js
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import DOMPurify from 'dompurify';
import SVGNest from './lib/svgnest.js';
import SVGParser from './lib/svgparser.js';

// --- Global Variables ---
const serverUrl = 'http://localhost:3000'; // Define server URL once
let authToken = localStorage.getItem('authToken');
// --- DOM Elements ---
let ordersListDiv, noOrdersMessage, refreshOrdersBtn, nestStickersBtn, nestedSvgContainer, spacingInput, registerBtn, loginBtn, authStatus, loadingIndicator, errorToast, errorMessage, closeErrorToast, successToast, successMessage, closeSuccessToast, searchInput, searchBtn, downloadCutFileBtn, authStatusDiv;

// --- Helper Functions ---

/**
 * A helper function to fetch data from the server with authentication.
 * @param {string} url The URL to fetch from.
 * @param {object} options The options for the fetch request.
 * @returns {Promise<any>} The JSON response from the server.
 */
async function fetchWithAuth(url, options = {}) {
    const headers = {
        ...options.headers,
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        // Token is invalid or expired, clear it and force re-login
        logout();
        throw new Error('Authentication required. Please log in again.');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'An unknown error occurred.' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
}


// --- Authentication Flow (WebAuthn) ---

async function handleLogin() {
    const username = prompt("Please enter your username:");
    if (!username) {
        updateAuthStatus('Login canceled.');
        return;
    }

    try {
        updateAuthStatus('Requesting login options from server...');

        // 1. Get login options from the server
        const options = await fetchWithAuth(`${SERVER_URL}/api/auth/login-options?username=${username}`);

        // This is a necessary step to decode the base64url encoded challenge and credential IDs
        options.challenge = bufferDecode(options.challenge);
        options.allowCredentials.forEach(cred => {
            cred.id = bufferDecode(cred.id);
        });

        updateAuthStatus('Please use your security key to log in...');

        // 2. Use the browser's credentials API
        const assertion = await navigator.credentials.get({ publicKey: options });

        // 3. Send the assertion to the server to verify
        updateAuthStatus('Verifying login with server...');
        const verificationResponse = await fetch(`${SERVER_URL}/api/auth/login-verify?username=${username}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: assertion.id,
                rawId: bufferEncode(assertion.rawId),
                response: {
                    clientDataJSON: bufferEncode(assertion.response.clientDataJSON),
                    authenticatorData: bufferEncode(assertion.response.authenticatorData),
                    signature: bufferEncode(assertion.response.signature),
                    userHandle: bufferEncode(assertion.response.userHandle),
                },
                type: assertion.type,
            }),
        });

        const verificationJSON = await verificationResponse.json();

        if (verificationJSON.verified && verificationJSON.token) {
            authToken = verificationJSON.token;
            localStorage.setItem('authToken', authToken);
            updateAuthStatus(`Login successful! Welcome, ${username}.`);
            loginBtn.textContent = 'Log Out';
            loginBtn.removeEventListener('click', handleLogin);
            loginBtn.addEventListener('click', logout);
            // Fetch orders now that we are logged in
            fetchAndDisplayOrders();
        } else {
            throw new Error('Login verification failed.');
        }

    } catch (error) {
        console.error('Login failed:', error);
        updateAuthStatus(`Login failed: ${error.message}`);
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('authToken');
    updateAuthStatus('You are logged out.');
    loginBtn.textContent = 'Login with YubiKey';
    loginBtn.removeEventListener('click', logout);
    loginBtn.addEventListener('click', handleLogin);
    // Clear the orders list
    ordersListDiv.innerHTML = '';
    noOrdersMessage.textContent = 'Please log in to view orders.';
    noOrdersMessage.style.display = 'block';
}

function updateAuthStatus(message) {
    if (authStatusDiv) {
        authStatusDiv.textContent = message;
    }
}

// --- Order Fetching and Display ---

async function fetchAndDisplayOrders() {
    if (!authToken) {
        noOrdersMessage.textContent = 'Please log in to view orders.';
        return;
    }

    noOrdersMessage.textContent = 'Loading orders...';
    noOrdersMessage.style.display = 'block';
    ordersListDiv.innerHTML = ''; // Clear previous orders

    try {
        const orders = await fetchWithAuth(`${SERVER_URL}/api/orders`);

        if (orders.length === 0) {
            noOrdersMessage.textContent = 'No orders found.';
        } else {
            noOrdersMessage.style.display = 'none';
            orders.forEach(displayOrder);
        }
    } catch (error) {
        console.error('Failed to fetch orders:', error);
        noOrdersMessage.textContent = `Error fetching orders: ${error.message}`;
    }
}

function displayOrder(order) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.id = `order-${order.orderId}`;

    const formattedAmount = order.amount ? `$${(order.amount / 100).toFixed(2)}` : 'N/A';

    card.innerHTML = `
        <h3 class="text-xl text-splotch-red">Order ID: <span class="font-mono text-sm">${order.orderId.substring(0, 8)}...</span></h3>
        <p class="text-sm text-gray-600">Received: ${new Date(order.receivedAt).toLocaleString()}</p>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 order-details">
            <div>
                <dt>Name:</dt>
                <dd>${order.billingContact.givenName || ''} ${order.billingContact.familyName || ''}</dd>
                <dt>Email:</dt>
                <dd>${order.billingContact.email || 'N/A'}</dd>
            </div>
            <div>
                <dt>Quantity:</dt>
                <dd>${order.orderDetails.quantity || 'N/A'}</dd>
                <dt>Amount:</dt>
                <dd>${formattedAmount}</dd>
            </div>
        </div>
        <div class="mt-2">
            <dt>Status:</dt>
            <dd class="status-${order.status.toLowerCase()} inline-block px-2 py-1 rounded-full text-xs font-semibold">${order.status}</dd>
        </div>
        <div class="mt-2">
            <img src="${SERVER_URL}${order.designImagePath}" alt="Sticker Design" class="sticker-design" style="max-width: 150px;">
        </div>
    `;

    ordersListDiv.prepend(card);
}


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    ordersListDiv = document.getElementById('orders-list');
    noOrdersMessage = document.getElementById('no-orders-message');
    refreshOrdersBtn = document.getElementById('refreshOrdersBtn');
    nestStickersBtn = document.getElementById('nestStickersBtn');
    nestedSvgContainer = document.getElementById('nested-svg-container');
    spacingInput = document.getElementById('spacingInput');
    registerBtn = document.getElementById('registerBtn');
    loginBtn = document.getElementById('loginBtn');
    authStatusDiv = document.getElementById('auth-status');
    authStatus = document.getElementById('auth-status');
    loadingIndicator = document.getElementById('loading-indicator');
    errorToast = document.getElementById('error-toast');
    errorMessage = document.getElementById('error-message');
    closeErrorToast = document.getElementById('close-error-toast');
    successToast = document.getElementById('success-toast');
    successMessage = document.getElementById('success-message');
    closeSuccessToast = document.getElementById('close-success-toast');
    searchInput = document.getElementById('searchInput');
    searchBtn = document.getElementById('searchBtn');
    downloadCutFileBtn = document.getElementById('downloadCutFileBtn');

    if (refreshOrdersBtn) {
        refreshOrdersBtn.addEventListener('click', fetchAndDisplayOrders);
    }

    if (downloadCutFileBtn) {
        downloadCutFileBtn.addEventListener('click', handleDownloadCutFile);
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }

    if (nestStickersBtn) {
        nestStickersBtn.addEventListener('click', handleNesting);
    }

    if (registerBtn) {
        registerBtn.addEventListener('click', handleRegistration);
    }

    if (loginBtn) {
if (authToken) {
            loginBtn.textContent = 'Log Out';
            loginBtn.addEventListener('click', logout);
            updateAuthStatus('Logged in.');
            fetchAndDisplayOrders();
        } else {
            loginBtn.addEventListener('click', handleLogin);
            updateAuthStatus('Please log in.');
        }
    }
        loginBtn.addEventListener('click', handleAuthentication);
    }

    // Fetch orders when the page loads
    fetchAndDisplayOrders();
    getCsrfToken();
});
// --- WebAuthn Buffer Helpers ---
function bufferDecode(value) {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
let csrfToken;
let authToken;
function bufferEncode(value) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

async function getCsrfToken() {
    try {
        const response = await fetch(`${serverUrl}/api/csrf-token`);
        const data = await response.json();
        csrfToken = data.csrfToken;
    } catch (error) {
        console.error('Error fetching CSRF token:', error);
    }
}

function showLoadingIndicator() {
    loadingIndicator.classList.remove('hidden');
}

function hideLoadingIndicator() {
    loadingIndicator.classList.add('hidden');
}

function showErrorToast(message) {
    errorMessage.textContent = message;
    errorToast.classList.remove('hidden');
}

function hideErrorToast() {
    errorToast.classList.add('hidden');
}

closeErrorToast.addEventListener('click', hideErrorToast);

function showSuccessToast(message) {
    successMessage.textContent = message;
    successToast.classList.remove('hidden');
}

function hideSuccessToast() {
    successToast.classList.add('hidden');
}

closeSuccessToast.addEventListener('click', hideSuccessToast);

/**
 * Fetches orders from the server and updates the UI.
 */
async function fetchAndDisplayOrders() {
    showLoadingIndicator();
    console.log('[SHOP] Fetching orders from server...');
    if (noOrdersMessage) {
        noOrdersMessage.textContent = 'Loading orders...';
        noOrdersMessage.style.display = 'block';
    }
    // Clear the current list
    ordersListDiv.innerHTML = '';

    try {
        const response = await fetch(`${serverUrl}/api/orders`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
            },
        });
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        const orders = await response.json();
        console.log(`[SHOP] Received ${orders.length} orders from server.`);

        if (orders.length === 0) {
            if (noOrdersMessage) noOrdersMessage.textContent = 'No new orders yet.';
        } else {
            if (noOrdersMessage) noOrdersMessage.style.display = 'none';
            orders.forEach(order => displayOrder(order));
        }

    } catch (error) {
        console.error('[SHOP] Error fetching orders:', error);
        showErrorToast(`Error fetching orders: ${error.message}. Is the server running?`);
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

    const paths = nestedSvgElement.querySelectorAll('path');
    paths.forEach(path => {
        const newPath = path.cloneNode();
        newPath.setAttribute('stroke', 'red');
        newPath.setAttribute('fill', 'none');
        cutFileSvg.appendChild(newPath);
    });

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(cutFileSvg);

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

async function handleSearch() {
    const orderId = searchInput.value;

    if (!orderId) {
        return;
    }

    showLoadingIndicator();
    ordersListDiv.innerHTML = '';

    try {
        const response = await fetch(`${serverUrl}/api/orders/${orderId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }

        const order = await response.json();
        displayOrder(order);
    } catch (error) {
        console.error(`[SHOP] Error searching for order ${orderId}:`, error);
        showErrorToast(`Error searching for order ${orderId}: ${error.message}`);
    } finally {
        hideLoadingIndicator();
    }
}

/**
 * Renders a single order card into the DOM.
 * @param {object} order - The order object from the server.
 */
function displayOrder(order) {
    if (!ordersListDiv) return;

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
                <p class="text-sm text-gray-600">Payment ID: ${order.paymentId}</p>
            </div>
            <div id="status-badge-${order.orderId}" class="status-${order.status.toLowerCase()} font-bold py-1 px-3 rounded-full text-sm">
                ${order.status}
            </div>
        </div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 order-details">
            <div>
                <dt>Name:</dt>
                <dd>${order.billingContact?.givenName || ''} ${order.billingContact?.familyName || ''}</dd>
                <dt>Email:</dt>
                <dd>${order.billingContact?.email || 'N/A'}</dd>
                <dt>Address:</dt>
                <dd>${order.billingContact?.addressLines?.join(', ') || ''}, ${order.billingContact?.city || ''}, ${order.billingContact?.state || ''} ${order.billingContact?.postalCode || ''}</dd>
            </div>
            <div>
                <dt>Quantity:</dt>
                <dd>${order.orderDetails?.quantity || 'N/A'}</dd>
                <dt>Material:</dt>
                <dd>${order.orderDetails?.material || 'N/A'}</dd>
                <dt>Amount:</dt>
                <dd>${formattedAmount}</dd>
            </div>
        </div>
        <div class="mt-4">
            <dt>Sticker Design:</dt>
            <a href="${serverUrl}${order.designImagePath}" target="_blank">
                <img src="${serverUrl}${order.designImagePath}" alt="Sticker Design" class="sticker-design">
            </a>
        </div>
    `);
        <div class="mt-4 flex flex-wrap gap-2">
            <button class="action-btn bg-green-500 hover:bg-green-600 text-white py-1 px-3 rounded-md" data-order-id="${order.orderId}" data-status="ACCEPTED">Accept</button>
            <button class="action-btn bg-purple-500 hover:bg-purple-600 text-white py-1 px-3 rounded-md" data-order-id="${order.orderId}" data-status="PRINTING">Mark as Printing</button>
            <button class="action-btn bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded-md" data-order-id="${order.orderId}" data-status="SHIPPED">Mark as Shipped</button>
            <button class="action-btn bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-md" data-order-id="${order.orderId}" data-status="CANCELED">Cancel Order</button>
        </div>
        <p id="status-update-msg-${order.orderId}" class="text-sm italic mt-2"></p>
    `;

    ordersListDiv.appendChild(card);

    // Add event listeners to the action buttons for this card
    card.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const orderId = e.target.dataset.orderId;
            const status = e.target.dataset.status;
            updateOrderStatus(orderId, status);
        });
    });
}

/**
 * Sends a request to the server to update the order's status.
 * @param {string} orderId - The ID of the order to update.
 * @param {string} newStatus - The new status for the order.
 */
async function updateOrderStatus(orderId, newStatus) {
    showLoadingIndicator();
    console.log(`[SHOP] Updating order ${orderId} to status ${newStatus}`);
    const statusMsgEl = document.getElementById(`status-update-msg-${orderId}`);
    if (statusMsgEl) statusMsgEl.textContent = `Updating status to ${newStatus}...`;

    try {
        const response = await fetch(`${serverUrl}/api/orders/${orderId}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ status: newStatus }),
        });

        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(responseData.error || `Server responded with status ${response.status}`);
        }

        console.log(`[SHOP] Successfully updated status for order ${orderId}.`, responseData);
        showSuccessToast(`Status updated to ${newStatus} successfully!`);

        // Update the status badge in the UI
        const statusBadgeEl = document.getElementById(`status-badge-${orderId}`);
        if (statusBadgeEl) {
            statusBadgeEl.className = `status-${newStatus.toLowerCase()} font-bold py-1 px-3 rounded-full text-sm`;
            statusBadgeEl.textContent = newStatus;
        }

        // Hide the status message after a few seconds
        setTimeout(() => {
            if (statusMsgEl) statusMsgEl.textContent = '';
        }, 3000);

    } catch (error) {
        console.error(`[SHOP] Error updating status for order ${orderId}:`, error);
        showErrorToast(`Error updating status for order ${orderId}: ${error.message}`);
    } finally {
        hideLoadingIndicator();
    }
}

/**
 * Handles the sticker nesting process.
 */
async function handleNesting() {
    showLoadingIndicator();
    console.log('[SHOP] Starting nesting process...');
    nestedSvgContainer.innerHTML = '<p>Nesting in progress...</p>';

    // 1. Gather all SVG URLs from the displayed orders
    const svgUrls = Array.from(ordersListDiv.querySelectorAll('.sticker-design'))
        .map(img => img.src);

    if (svgUrls.length === 0) {
        nestedSvgContainer.innerHTML = '<p>No designs to nest.</p>';
        return;
    }

    try {
        // 2. Fetch all SVG content
        const svgStrings = await Promise.all(
            svgUrls.map(url => fetch(url).then(res => res.text()))
        );

        // 3. Define a bin (the material to cut from)
        // For this example, let's use a standard 12x12 inch sheet (assuming 96 dpi)
        const binWidth = 12 * 96;
        const binHeight = 12 * 96;
        const binSvg = `<svg width="${binWidth}" height="${binHeight}"><rect x="0" y="0" width="${binWidth}" height="${binHeight}" fill="none" stroke="blue" stroke-width="2"/></svg>`;

        // 4. Parse SVGs and prepare for nesting
        const parser = new SVGParser();
        const svgs = svgStrings.map(s => parser.load(s));
        const bin = parser.load(binSvg);

        // 5. Configure and run SVGNest
        const spacing = parseInt(spacingInput.value, 10) || 0;
        const options = {
            spacing: spacing, // spacing between parts
            rotations: 4, // 0, 90, 180, 270 degrees
        };
        const nest = new SVGNest(bin, svgs, options);
        const resultSvg = nest.start(); // This can be sync or async depending on web workers

        // 6. Display the nested SVG
        nestedSvgContainer.innerHTML = resultSvg;
        console.log('[SHOP] Nesting complete.');
        showSuccessToast('Nesting complete.');

        // 7. Generate and store the cut file
        window.nestedSvg = resultSvg;

    } catch (error) {
        console.error('[SHOP] Error during nesting:', error);
        showErrorToast(`Nesting failed: ${error.message}`);
    } finally {
        hideLoadingIndicator();
    }
}

/**
 * Handles the registration process.
 */
async function handleRegistration() {
    showLoadingIndicator();
    authStatus.innerHTML = '';

    try {
        // Get registration options from the server
        const resp = await fetch(`${serverUrl}/api/auth/register-options`);
        const opts = await resp.json();

        // Start the registration process
        const regResp = await startRegistration(opts);

        // Send the registration response to the server
        const verificationResp = await fetch(`${serverUrl}/api/auth/register-verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify(regResp),
        });

        const verificationJSON = await verificationResp.json();

        if (verificationJSON && verificationJSON.verified) {
            showSuccessToast('YubiKey registered successfully!');
        } else {
            showErrorToast(`Error registering YubiKey: ${verificationJSON.error}`);
        }
    } catch (error) {
        console.error('[SHOP] Error during registration:', error);
        showErrorToast(`Error registering YubiKey: ${error.message}`);
    } finally {
        hideLoadingIndicator();
    }
}

/**
 * Handles the authentication process.
 */
async function handleAuthentication() {
    showLoadingIndicator();
    authStatus.innerHTML = '';

    try {
        // Get authentication options from the server
        const resp = await fetch(`${serverUrl}/api/auth/login-options`);
        const opts = await resp.json();

        // Start the authentication process
        const authResp = await startAuthentication(opts);

        // Send the authentication response to the server
        const verificationResp = await fetch(`${serverUrl}/api/auth/login-verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify(authResp),
        });

        const verificationJSON = await verificationResp.json();

        if (verificationJSON && verificationJSON.verified) {
            authToken = verificationJSON.token;
            showSuccessToast('Login successful!');
        } else {
            showErrorToast(`Error logging in: ${verificationJSON.error}`);
        }
    } catch (error) {
        console.error('[SHOP] Error during authentication:', error);
        showErrorToast(`Error logging in: ${error.message}`);
    } finally {
        hideLoadingIndicator();
    }
}
