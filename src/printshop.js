// printshop.js
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import SVGNest from './lib/svgnest.js';
import SVGParser from './lib/svgparser.js';

const serverUrl = 'http://localhost:3000'; // Define server URL once

// --- DOM Elements ---
let ordersListDiv, noOrdersMessage, refreshOrdersBtn, nestStickersBtn, nestedSvgContainer, spacingInput, registerBtn, loginBtn, authStatus;

// --- Main Setup ---
document.addEventListener('DOMContentLoaded', () => {
    ordersListDiv = document.getElementById('orders-list');
    noOrdersMessage = document.getElementById('no-orders-message');
    refreshOrdersBtn = document.getElementById('refreshOrdersBtn');
    nestStickersBtn = document.getElementById('nestStickersBtn');
    nestedSvgContainer = document.getElementById('nested-svg-container');
    spacingInput = document.getElementById('spacingInput');
    registerBtn = document.getElementById('registerBtn');
    loginBtn = document.getElementById('loginBtn');
    authStatus = document.getElementById('auth-status');

    if (refreshOrdersBtn) {
        refreshOrdersBtn.addEventListener('click', fetchAndDisplayOrders);
    }

    if (nestStickersBtn) {
        nestStickersBtn.addEventListener('click', handleNesting);
    }

    if (registerBtn) {
        registerBtn.addEventListener('click', handleRegistration);
    }

    if (loginBtn) {
        loginBtn.addEventListener('click', handleAuthentication);
    }

    // Fetch orders when the page loads
    fetchAndDisplayOrders();
});

/**
 * Fetches orders from the server and updates the UI.
 */
async function fetchAndDisplayOrders() {
    console.log('[SHOP] Fetching orders from server...');
    if (noOrdersMessage) {
        noOrdersMessage.textContent = 'Loading orders...';
        noOrdersMessage.style.display = 'block';
    }
    // Clear the current list
    ordersListDiv.innerHTML = '';

    try {
        const response = await fetch(`${serverUrl}/api/orders`);
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
        if (noOrdersMessage) {
            noOrdersMessage.textContent = `Error fetching orders: ${error.message}. Is the server running?`;
        }
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

    card.innerHTML = `
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
    console.log(`[SHOP] Updating order ${orderId} to status ${newStatus}`);
    const statusMsgEl = document.getElementById(`status-update-msg-${orderId}`);
    if (statusMsgEl) statusMsgEl.textContent = `Updating status to ${newStatus}...`;

    try {
        const response = await fetch(`${serverUrl}/api/orders/${orderId}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: newStatus }),
        });

        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(responseData.error || `Server responded with status ${response.status}`);
        }

        console.log(`[SHOP] Successfully updated status for order ${orderId}.`, responseData);
        if (statusMsgEl) statusMsgEl.textContent = `Status updated to ${newStatus} successfully!`;

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
        if (statusMsgEl) statusMsgEl.textContent = `Error: ${error.message}`;
    }
}

/**
 * Handles the sticker nesting process.
 */
async function handleNesting() {
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

    } catch (error) {
        console.error('[SHOP] Error during nesting:', error);
        nestedSvgContainer.innerHTML = `<p class="text-red-500">Nesting failed: ${error.message}</p>`;
    }
}

/**
 * Handles the registration process.
 */
async function handleRegistration() {
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
            },
            body: JSON.stringify(regResp),
        });

        const verificationJSON = await verificationResp.json();

        if (verificationJSON && verificationJSON.verified) {
            authStatus.innerHTML = '<p class="text-green-500">YubiKey registered successfully!</p>';
        } else {
            authStatus.innerHTML = `<p class="text-red-500">Error registering YubiKey: ${verificationJSON.error}</p>`;
        }
    } catch (error) {
        console.error('[SHOP] Error during registration:', error);
        authStatus.innerHTML = `<p class="text-red-500">Error registering YubiKey: ${error.message}</p>`;
    }
}

/**
 * Handles the authentication process.
 */
async function handleAuthentication() {
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
            },
            body: JSON.stringify(authResp),
        });

        const verificationJSON = await verificationResp.json();

        if (verificationJSON && verificationJSON.verified) {
            authStatus.innerHTML = '<p class="text-green-500">Login successful!</p>';
        } else {
            authStatus.innerHTML = `<p class="text-red-500">Error logging in: ${verificationJSON.error}</p>`;
        }
    } catch (error) {
        console.error('[SHOP] Error during authentication:', error);
        authStatus.innerHTML = `<p class="text-red-500">Error logging in: ${error.message}</p>`;
    }
}
