const serverUrl = 'http://localhost:3000';

const loginStatus = document.getElementById('login-status');
const orderHistory = document.getElementById('order-history');
const ordersList = document.getElementById('orders-list');

window.addEventListener('load', async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
        loginStatus.innerHTML = '<p>No login token found.</p>';
        return;
    }

    try {
        const response = await fetch(`${serverUrl}/api/auth/verify-magic-link`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (data.success) {
            loginStatus.classList.add('hidden');
            orderHistory.classList.remove('hidden');
            fetchOrderHistory(data.token);
        } else {
            loginStatus.innerHTML = `<p>Error logging in: ${data.error}</p>`;
        }
    } catch (error) {
        console.error('Error verifying magic link:', error);
        loginStatus.innerHTML = `<p>Error logging in: ${error.message}</p>`;
    }
});

async function fetchOrderHistory(token) {
    try {
        const response = await fetch(`${serverUrl}/api/orders`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }

        const orders = await response.json();
        displayOrderHistory(orders);
    } catch (error) {
        console.error('Error fetching order history:', error);
        ordersList.innerHTML = `<p>Error fetching order history: ${error.message}</p>`;
    }
}

function displayOrderHistory(orders) {
    if (orders.length === 0) {
        ordersList.innerHTML = '<p>You have no past orders.</p>';
        return;
    }

    orders.forEach(order => {
        const orderDiv = document.createElement('div');
        orderDiv.classList.add('p-4', 'bg-white', 'rounded-lg', 'shadow-md');
        orderDiv.innerHTML = `
            <h3 class="text-xl font-semibold">${order.orderDetails.material} Stickers</h3>
            <p>Quantity: ${order.orderDetails.quantity}</p>
            <p>Order ID: ${order.orderId}</p>
            <p>Status: ${order.status}</p>
        `;
        ordersList.appendChild(orderDiv);
    });
}
