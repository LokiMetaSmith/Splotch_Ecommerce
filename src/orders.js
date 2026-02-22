let csrfToken;

async function fetchCsrfToken() {
  try {
    const response = await fetch("/api/csrf-token", { credentials: "include" });
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
    const loginStatus = document.getElementById("login-status");
    if (loginStatus) {
      loginStatus.textContent =
        "A security token could not be loaded. Please refresh the page.";
      loginStatus.style.color = "red";
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await fetchCsrfToken();

  const loginSection = document.getElementById("login-section");
  const orderHistorySection = document.getElementById("order-history-section");
  const loginBtn = document.getElementById("loginBtn");
  const emailInput = document.getElementById("emailInput");
  const loginStatus = document.getElementById("login-status");
  const ordersList = document.getElementById("orders-list");
  const noOrdersMessage = document.getElementById("no-orders-message");
  const dataPrivacySection = document.getElementById("data-privacy-section");

  // Bolt Optimization: Event Delegation for reorder buttons
  ordersList.addEventListener("click", (e) => {
    const reorderBtn = e.target.closest(".reorder-btn");
    if (reorderBtn) {
      const designImage = reorderBtn.dataset.designImage;
      // For now, redirect to the main page with the image URL as a query param
      // A more robust solution would pre-fill all options
      window.location.href = `/?design=${encodeURIComponent(designImage)}`;
    }
  });
  const exportDataBtn = document.getElementById("exportDataBtn");
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  const privacyStatus = document.getElementById("privacy-status");

  // Check for magic link token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");

  if (token) {
    verifyTokenAndFetchOrders(token);
  }

  // Privacy Event Listeners
  if (exportDataBtn) {
    exportDataBtn.addEventListener("click", async () => {
      if (!csrfToken) return;
      const originalText = exportDataBtn.innerHTML;
      setButtonLoading(exportDataBtn, true, originalText, "Exporting...");
      privacyStatus.textContent = "Exporting data...";
      privacyStatus.style.color = "blue";
      try {
        // Re-fetch token from URL in case needed, or pass it down?
        // Actually token is available in scope if we move this inside verify...
        // But let's assume token is still in URL or stored.
        // The current architecture relies on URL param 'token' for auth in fetch calls within this file.
        const currentToken = new URLSearchParams(window.location.search).get(
          "token",
        );

        const response = await fetch("/api/auth/user/data", {
          headers: {
            Authorization: `Bearer ${currentToken}`,
          },
        });
        if (!response.ok) throw new Error("Failed to fetch data");
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "splotch-user-data.json";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        privacyStatus.textContent = "Data exported successfully.";
        privacyStatus.style.color = "green";
      } catch (e) {
        privacyStatus.textContent = "Error exporting data: " + e.message;
        privacyStatus.style.color = "red";
      } finally {
        setButtonLoading(exportDataBtn, false, originalText);
      }
    });
  }

  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", async () => {
      if (
        !window.confirm(
          "Are you sure you want to delete your account? This action cannot be undone and will anonymize your order history.",
        )
      ) {
        return;
      }

      const originalText = deleteAccountBtn.innerHTML;
      setButtonLoading(deleteAccountBtn, true, originalText, "Deleting...");
      privacyStatus.textContent = "Deleting account...";
      privacyStatus.style.color = "red";
      try {
        const currentToken = new URLSearchParams(window.location.search).get(
          "token",
        );
        const response = await fetch("/api/auth/user", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${currentToken}`,
            "X-CSRF-Token": csrfToken,
          },
        });
        if (!response.ok) throw new Error("Failed to delete account");
        alert("Your account has been deleted.");
        window.location.href = "/";
      } catch (e) {
        privacyStatus.textContent = "Error deleting account: " + e.message;
        privacyStatus.style.color = "red";
        setButtonLoading(deleteAccountBtn, false, originalText);
      }
    });
  }

  document
    .getElementById("magic-link-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = emailInput.value;
      if (!email) {
        loginStatus.textContent = "Please enter a valid email address.";
        loginStatus.style.color = "red";
        return;
      }

      const originalText = loginBtn.innerHTML;
      const originalClassName = loginBtn.className;
      loginBtn.disabled = true;
      loginBtn.innerHTML = `
            <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Sending...</span>
        `;
      // Ensure disabled style is applied visually if not handled by CSS
      loginBtn.classList.add("opacity-75", "cursor-not-allowed");

      let success = false;

      try {
        if (!csrfToken) {
          throw new Error(
            "CSRF token is not available. Please refresh the page.",
          );
        }
        const response = await fetch("/api/auth/magic-login", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ email, redirectPath: "/orders.html" }),
        });

        const data = await response.json();

        if (response.ok) {
          success = true;
          loginStatus.textContent = "Magic link sent! Please check your email.";
          loginStatus.style.color = "green";
        } else {
          throw new Error(data.error || "Failed to send magic link.");
        }
      } catch (error) {
        loginStatus.textContent = `Error: ${error.message}`;
        loginStatus.style.color = "red";
      } finally {
        if (!success) {
          loginBtn.disabled = false;
          loginBtn.innerHTML = originalText;
          loginBtn.className = originalClassName;
        } else {
          // Success: Show Cooldown
          let cooldown = 30;
          loginBtn.disabled = true;
          loginBtn.classList.add("cursor-not-allowed");
          loginBtn.classList.remove("bg-splotch-red");
          loginBtn.classList.add("bg-green-600"); // Success color

          const updateButtonText = () => {
            loginBtn.innerHTML = `
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>Sent! Retry in ${cooldown}s</span>
            `;
          };

          updateButtonText();

          const timer = setInterval(() => {
            cooldown--;
            if (cooldown <= 0) {
              clearInterval(timer);
              loginBtn.disabled = false;
              loginBtn.innerHTML = originalText;
              loginBtn.className = originalClassName;
            } else {
              updateButtonText();
            }
          }, 1000);
        }
      }
    });

  async function verifyTokenAndFetchOrders(authToken) {
    loginSection.classList.add("hidden");
    orderHistorySection.classList.remove("hidden");
    if (dataPrivacySection) dataPrivacySection.classList.remove("hidden");

    try {
      const response = await fetch("/api/orders/my-orders", {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Could not fetch your orders.");
      }

      const orders = await response.json();
      displayOrders(orders, authToken);
    } catch (error) {
      noOrdersMessage.textContent = `Error loading orders: ${error.message}`;
      noOrdersMessage.style.color = "red";
    }
  }

  function displayOrders(orders, authToken) {
    if (orders.length === 0) {
      ordersList.innerHTML = ""; // Clear content
      ordersList.appendChild(noOrdersMessage); // Show the "no orders" message
      return;
    }

    // Bolt Optimization: Batch DOM updates using innerHTML
    const html = orders
      .map((order) => {
        const receivedDate = new Date(order.receivedAt).toLocaleDateString();
        const formattedAmount = order.amount
          ? `$${(order.amount / 100).toFixed(2)}`
          : "N/A";

        return `
            <div class="order-card p-4 border rounded-lg shadow-sm bg-gray-50">
                <div class="flex flex-col sm:flex-row justify-between items-start">
                    <div>
                        <h3 class="text-lg font-semibold text-splotch-red">Order ID: <span class="font-mono text-sm">${order.orderId.substring(0, 8)}...</span></h3>
                        <p class="text-sm text-gray-600">Ordered on: ${receivedDate}</p>
                        <p class="text-sm text-gray-600">Amount: ${formattedAmount}</p>
                        <p class="text-sm text-gray-600 flex items-center gap-2">
                            Status: <span class="px-2 py-0.5 rounded-full text-xs font-bold status-${order.status.toLowerCase()}">${order.status}</span>
                        </p>
                    </div>
                    <div class="mt-4 sm:mt-0 sm:ml-4 flex-shrink-0">
                        <img src="${order.designImagePath}" alt="Sticker Design" class="w-24 h-24 object-cover border rounded-md">
                    </div>
                </div>
                <div class="mt-4">
                    <button class="reorder-btn button is-primary text-sm" data-design-image="${order.designImagePath}">Reorder This Sticker</button>
                </div>
            </div>`;
      })
      .join("");

    ordersList.innerHTML = html;
  }
});

function setButtonLoading(
  button,
  isLoading,
  originalContent,
  loadingText = "Loading...",
) {
  if (isLoading) {
    button.disabled = true;
    button.innerHTML = `
            <svg class="animate-spin h-5 w-5 text-white inline-block mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>${loadingText}</span>
        `;
    button.classList.add("opacity-75", "cursor-not-allowed");
  } else {
    button.disabled = false;
    button.innerHTML = originalContent;
    button.classList.remove("opacity-75", "cursor-not-allowed");
  }
}
