// printshop.js

// --- Global Variables ---
const SERVER_URL = 'http://localhost:3000';
let authToken = localStorage.getItem('authToken');

// --- DOM Elements ---
let ordersListDiv, noOrdersMessage, refreshOrdersBtn, loginBtn, authStatusDiv;

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
    loginBtn = document.getElementById('loginBtn');
    authStatusDiv = document.getElementById('auth-status');

    if (refreshOrdersBtn) {
        refreshOrdersBtn.addEventListener('click', fetchAndDisplayOrders);
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
});

// --- WebAuthn Buffer Helpers ---
function bufferDecode(value) {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

function bufferEncode(value) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}
