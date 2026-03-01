const serverUrl = "http://localhost:3000";
let csrfToken;

const loginStatus = document.getElementById("login-status");
const orderHistory = document.getElementById("order-history");
const ordersList = document.getElementById("orders-list");

function escapeHtml(unsafe) {
  if (unsafe == null) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchCsrfToken() {
  try {
    const response = await fetch(`${serverUrl}/api/csrf-token`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const data = await response.json();
    if (!data.csrfToken) {
      throw new Error("CSRF token not found in server response");
    }
    csrfToken = data.csrfToken;
  } catch (error) {
    console.error("Error fetching CSRF token:", error);
    loginStatus.innerHTML =
      "<p>A security token could not be loaded. Please refresh the page.</p>";
  }
}

window.addEventListener("load", async () => {
  await fetchCsrfToken();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    loginStatus.innerHTML = "<p>No login token found.</p>";
    return;
  }

  try {
    const response = await fetch(`${serverUrl}/api/auth/verify-magic-link`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ token }),
    });

    const data = await response.json();

    if (data.success) {
      loginStatus.classList.add("hidden");
      orderHistory.classList.remove("hidden");
      fetchOrderHistory(data.token);
    } else {
      loginStatus.innerHTML = `<p>Error logging in: ${escapeHtml(data.error)}</p>`;
    }
  } catch (error) {
    console.error("Error verifying magic link:", error);
    loginStatus.innerHTML = `<p>Error logging in: ${escapeHtml(error.message)}</p>`;
  }
});

async function fetchOrderHistory(token) {
  try {
    const response = await fetch(`${serverUrl}/api/orders`, {
      credentials: "include",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    const orders = await response.json();
    displayOrderHistory(orders);
  } catch (error) {
    console.error("Error fetching order history:", error);
    ordersList.innerHTML = `<p>Error fetching order history: ${escapeHtml(error.message)}</p>`;
  }
}

function displayOrderHistory(orders) {
  if (orders.length === 0) {
    ordersList.innerHTML = "<p>You have no past orders.</p>";
    return;
  }

  orders.forEach((order) => {
    const orderDiv = document.createElement("div");
    orderDiv.classList.add("p-4", "bg-white", "rounded-lg", "shadow-md");
    orderDiv.innerHTML = `
            <h3 class="text-xl font-semibold">${escapeHtml(order.orderDetails.material)} Stickers</h3>
            <p>Quantity: ${escapeHtml(String(order.orderDetails.quantity))}</p>
            <p>Order ID: ${escapeHtml(order.orderId)}</p>
            <p>Status: ${escapeHtml(order.status)}</p>
        `;
    ordersList.appendChild(orderDiv);
  });
}
