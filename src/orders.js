import '/styles.css';

const serverUrl = process.env.NODE_ENV === 'test' ? 'http://localhost:3001' : 'http://localhost:3000';
let csrfToken;

async function fetchCsrfToken() {
    try {
        const response = await fetch(`${serverUrl}/api/csrf-token`, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        const data = await response.json();
        if (!data.csrfToken) {
            throw new Error("CSRF token not found in server response");
        }
        csrfToken = data.csrfToken;
    } catch (error) {
        console.error('Error fetching CSRF token:', error);
        const loginStatus = document.getElementById('login-status');
        if (loginStatus) {
            loginStatus.textContent = 'A security token could not be loaded. Please refresh the page.';
            loginStatus.style.color = 'red';
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await fetchCsrfToken();

    const loginSection = document.getElementById('login-section');
    const orderHistorySection = document.getElementById('order-history-section');
    const loginBtn = document.getElementById('loginBtn');
    const emailInput = document.getElementById('emailInput');
    const loginStatus = document.getElementById('login-status');
    const ordersList = document.getElementById('orders-list');
    const noOrdersMessage = document.getElementById('no-orders-message');

    // Check for magic link token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
        verifyTokenAndFetchOrders(token);
    }

    loginBtn.addEventListener('click', async () => {
        const email = emailInput.value;
        if (!email) {
            loginStatus.textContent = 'Please enter a valid email address.';
            loginStatus.style.color = 'red';
            return;
        }

        try {
            if (!csrfToken) {
                throw new Error('CSRF token is not available. Please refresh the page.');
            }
            const response = await fetch(`${serverUrl}/api/auth/magic-login`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ email, redirectPath: '/orders.html' }),
            });

            const data = await response.json();

            if (response.ok) {
                loginStatus.textContent = 'Magic link sent! Please check your email.';
                loginStatus.style.color = 'green';
            } else {
                throw new Error(data.error || 'Failed to send magic link.');
            }
        } catch (error) {
            loginStatus.textContent = `Error: ${error.message}`;
            loginStatus.style.color = 'red';
        }
    });

    async function verifyTokenAndFetchOrders(authToken) {
        loginSection.classList.add('hidden');
        orderHistorySection.classList.remove('hidden');

        try {
            const response = await fetch(`${serverUrl}/api/orders/my-orders`, {
                credentials: 'include',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Could not fetch your orders.');
            }

            const orders = await response.json();
            displayOrders(orders, authToken);

        } catch (error) {
            noOrdersMessage.textContent = `Error loading orders: ${error.message}`;
            noOrdersMessage.style.color = 'red';
        }
    }

    function displayOrders(orders, authToken) {
        ordersList.innerHTML = ''; // Clear loading/error message
        if (orders.length === 0) {
            ordersList.appendChild(noOrdersMessage); // Show the "no orders" message
            return;
        }

        orders.forEach(order => {
            const orderCard = document.createElement('div');
            orderCard.className = 'p-4 border rounded-lg shadow-sm bg-gray-50';

            const receivedDate = new Date(order.receivedAt).toLocaleDateString();
            const formattedAmount = order.amount ? `$${(order.amount / 100).toFixed(2)}` : 'N/A';

            orderCard.innerHTML = `
                <div class="flex flex-col sm:flex-row justify-between items-start">
                    <div>
                        <h3 class="text-lg font-semibold text-splotch-red">Order ID: <span class="font-mono text-sm">${order.orderId.substring(0, 8)}...</span></h3>
                        <p class="text-sm text-gray-600">Ordered on: ${receivedDate}</p>
                        <p class="text-sm text-gray-600">Amount: ${formattedAmount}</p>
                        <p class="text-sm text-gray-600">Status: <span class="font-semibold">${order.status}</span></p>
                    </div>
                    <div class="mt-4 sm:mt-0 sm:ml-4 flex-shrink-0">
                        <img src="${serverUrl}${order.designImagePath}" alt="Sticker Design" class="w-24 h-24 object-cover border rounded-md">
                    </div>
                </div>
                <div class="mt-4">
                    <button class="reorder-btn button is-primary text-sm" data-design-image="${order.designImagePath}">Reorder This Sticker</button>
                </div>
            `;
            ordersList.appendChild(orderCard);
        });

        // Add event listeners to reorder buttons
        document.querySelectorAll('.reorder-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const designImage = e.target.dataset.designImage;
                // For now, redirect to the main page with the image URL as a query param
                // A more robust solution would pre-fill all options
                window.location.href = `/?design=${encodeURIComponent(designImage)}`;
            });
        });
    }
});
