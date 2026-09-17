const serverUrl = "";
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

function renderErrorState(title, message, isExpired = false) {
  loginStatus.className = "max-w-md mx-auto my-8";
  loginStatus.innerHTML = `
    <div class="text-center p-6 sm:p-8 bg-white rounded-2xl shadow-sm border border-gray-100">
      <div class="w-16 h-16 ${isExpired ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-600"} rounded-full flex items-center justify-center mx-auto mb-4">
        ${
          isExpired
            ? `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`
            : `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`
        }
      </div>
      <h2 class="text-2xl font-bold text-splotch-navy mb-2" style="letter-spacing: 0.5px;">
        ${escapeHtml(title)}
      </h2>
      <p class="text-gray-600 mb-6 text-sm sm:text-base leading-relaxed">
        ${escapeHtml(message)}
      </p>
      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <a href="/orders.html" class="inline-flex items-center justify-center gap-2 bg-splotch-red hover:brightness-110 text-white font-semibold py-3 px-6 rounded-full shadow-md transition duration-200 text-sm sm:text-base">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Send a New Magic Link
        </a>
        <a href="/" class="inline-flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-full transition duration-200 text-sm sm:text-base">
          Back to Home
        </a>
      </div>
    </div>
  `;
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
    renderErrorState(
      "Connection Error",
      "A security token could not be loaded. Please refresh the page or try sending a new magic link.",
      false,
    );
  }
}

window.addEventListener("load", async () => {
  await fetchCsrfToken();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    renderErrorState(
      "Missing Login Token",
      "No login token was found in this link. Please send a new magic link to access your orders.",
      false,
    );
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
      const isExpired =
        data.expired ||
        (data.error && data.error.toLowerCase().includes("expired"));
      const title = isExpired ? "Magic Link Expired" : "Invalid Magic Link";
      const message =
        data.message ||
        (isExpired
          ? "This magic link has expired. Magic links are only good for 15 minutes. Please send a new one to access your orders."
          : "This magic link is out of date or invalid. Please send a new one to access your orders.");
      renderErrorState(title, message, isExpired);
    }
  } catch (error) {
    console.error("Error verifying magic link:", error);
    renderErrorState(
      "Verification Failed",
      "We were unable to verify your login link. If your link is out of date, please send a new one.",
      false,
    );
  }
});

async function fetchOrderHistory(token) {
  try {
    const response = await fetch(`${serverUrl}/api/orders/my-orders`, {
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
    ordersList.innerHTML = `<p class="text-red-500 font-semibold p-4 bg-red-50 rounded-lg">Error fetching order history: ${escapeHtml(error.message)}</p>`;
  }
}

function displayOrderHistory(orders) {
  if (!orders || orders.length === 0) {
    ordersList.innerHTML = `
      <div class="text-center py-12 px-6 bg-white rounded-xl shadow-sm border border-gray-100 max-w-lg mx-auto">
        <div class="w-16 h-16 bg-blue-50 text-splotch-teal rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
        </div>
        <h3 class="text-2xl font-bold text-splotch-navy mb-2" style="font-family: var(--font-modak, cursive);">
          No Record of Orders Found!
        </h3>
        <p class="text-gray-600 mb-3 text-base">
          What would an account even do? As our FAQ says: we don't save customer accounts, we just print stickers!
        </p>
        <p class="text-gray-500 mb-6 text-sm">
          Looks like you don't have any past orders under this email yet. Our printshop hamsters are standing by—go make some stickers!
        </p>
        <a href="/" class="inline-block bg-splotch-red hover:brightness-110 text-white font-bold py-3 px-6 rounded-full shadow-md transition duration-200">
          🎨 Go Make Some Stickers!
        </a>
      </div>
    `;
    return;
  }

  orders.forEach((order) => {
    const orderDiv = document.createElement("div");
    orderDiv.classList.add("p-5", "bg-white", "rounded-lg", "shadow-md", "border", "border-gray-100");
    const material = order.orderDetails?.material || (order.stickers && order.stickers[0]?.material) || "Custom";
    const quantity = order.orderDetails?.quantity || (order.stickers && order.stickers[0]?.quantity) || 1;
    const formattedAmount = order.amount ? `$${(order.amount / 100).toFixed(2)}` : "";
    const receivedDate = order.receivedAt ? new Date(order.receivedAt).toLocaleDateString() : "";

    orderDiv.innerHTML = `
      <div class="flex justify-between items-start mb-2">
        <h3 class="text-xl font-bold text-splotch-navy">${escapeHtml(material)} Stickers</h3>
        <span class="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">${escapeHtml(order.status || 'PROCESSING')}</span>
      </div>
      <p class="text-gray-600 text-sm"><strong>Quantity:</strong> ${escapeHtml(String(quantity))}</p>
      <p class="text-gray-600 text-sm"><strong>Order ID:</strong> <span class="font-mono text-xs">${escapeHtml(order.orderId)}</span></p>
      ${receivedDate ? `<p class="text-gray-500 text-xs mt-1">Ordered on: ${escapeHtml(receivedDate)}</p>` : ""}
      ${formattedAmount ? `<p class="text-gray-700 font-semibold mt-2">Total: ${escapeHtml(formattedAmount)}</p>` : ""}
    `;
    ordersList.appendChild(orderDiv);
  });
}
