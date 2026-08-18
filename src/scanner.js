import { escapeHtml } from "./lib/canvas-utils.js";

const serverUrl =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : window.location.origin;

let authToken = localStorage.getItem("authToken");
let currentEntityId = null;
let currentEntityType = null; // 'order' or 'batch'

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("scanner-input");

  if (!authToken) {
      showError("You must be logged in as an admin. Please log in via the Print Shop first.");
      input.disabled = true;
      return;
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = input.value.trim();
      if (val) {
        handleScan(val);
        input.value = ""; // clear input for next scan
      }
    }
  });

  // Keep focus on input for hardware scanners
  document.addEventListener('click', (e) => {
      // If clicking outside an interactive element, refocus input
      if (!e.target.closest('button') && !e.target.closest('a') && e.target.tagName !== 'INPUT') {
          input.focus();
      }
  });

  document.querySelectorAll(".status-update-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
          const status = e.target.dataset.status;
          if (currentEntityId && currentEntityType && status) {
              updateStatus(currentEntityId, currentEntityType, status);
          }
      });
  });
});

async function handleScan(identifier) {
    // Basic cleanup of identifier (sometimes QR codes have extra chars or the ~ suffix we appended)
    identifier = identifier.replace(/~$/, '');
    // If it's a batch tracking code like "batch-12345-1", extract just the batch-12345 part
    if (identifier.startsWith("batch-")) {
        const parts = identifier.split('-');
        if (parts.length > 2) {
            identifier = parts[0] + '-' + parts[1];
        }
    } else {
        // order tracking codes? we didn't add the suffix there previously but just in case
        const parts = identifier.split('-');
        if (parts.length > 1 && !parts[0].startsWith('batch')) {
            identifier = parts[0];
        }
    }

    showLoading(true);
    hideMessages();
    document.getElementById("scan-result").classList.add("hidden");

    try {
        const res = await fetch(`${serverUrl}/api/admin/scan/${encodeURIComponent(identifier)}`, {
            headers: {
                Authorization: `Bearer ${authToken}`
            }
        });

        if (!res.ok) {
            if (res.status === 404) {
                throw new Error("Order or Batch not found for ID: " + identifier);
            }
            throw new Error(`Server error: ${res.statusText}`);
        }

        const data = await res.json();
        renderResult(data);
    } catch (err) {
        showError(err.message);
    } finally {
        showLoading(false);
    }
}

function renderResult(data) {
    currentEntityId = data.type === 'batch' ? data.data.batchId : data.data.orderId;
    currentEntityType = data.type;

    const resultEl = document.getElementById("scan-result");
    const typeEl = document.getElementById("result-type");
    const idEl = document.getElementById("result-id");
    const statusEl = document.getElementById("result-status");
    const detailsEl = document.getElementById("result-details");

    typeEl.textContent = data.type === 'batch' ? "Batch" : "Order";
    idEl.textContent = `ID: ${currentEntityId}`;

    // Status styling
    statusEl.textContent = data.data.status;
    statusEl.className = "px-3 py-1 rounded-full text-sm font-bold text-white ";
    if (data.data.status === 'NEW' || data.data.status === 'ACCEPTED') statusEl.classList.add("bg-blue-500");
    else if (data.data.status === 'PRINTING') statusEl.classList.add("bg-purple-500");
    else if (data.data.status === 'SHIPPED') statusEl.classList.add("bg-orange-500");
    else if (data.data.status === 'DELIVERED' || data.data.status === 'COMPLETED') statusEl.classList.add("bg-green-500");
    else statusEl.classList.add("bg-gray-500");

    let detailsHtml = "";
    if (data.type === 'batch') {
        detailsHtml += `<p><strong>Contains:</strong> ${data.data.orderIds.length} orders</p>`;
        detailsHtml += `<p><strong>Created:</strong> ${new Date(data.data.createdAt).toLocaleString()}</p>`;
    } else {
        const order = data.data;
        detailsHtml += `<p><strong>Customer:</strong> ${escapeHtml(order.customerDetails?.billing?.name || order.customerEmail || "N/A")}</p>`;
        detailsHtml += `<p><strong>Sticker:</strong> ${escapeHtml(order.orderDetails?.stickerName || "Custom")}</p>`;
        detailsHtml += `<p><strong>Material:</strong> ${escapeHtml(order.orderDetails?.material || "Standard")}</p>`;
        detailsHtml += `<p><strong>Qty:</strong> ${order.quantity}</p>`;
    }

    detailsEl.innerHTML = detailsHtml;
    resultEl.classList.remove("hidden");
}

async function updateStatus(id, type, status) {
    showLoading(true);
    hideMessages();

    try {
        let endpoint = "";
        let body = { status };

        if (type === 'batch') {
            endpoint = `/api/admin/batches/${encodeURIComponent(id)}/status`;
        } else {
            endpoint = `/api/orders/${encodeURIComponent(id)}/status`;
        }

        const res = await fetch(`${serverUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            throw new Error(`Failed to update status: ${res.statusText}`);
        }

        const resultData = await res.json();

        showSuccess(`Successfully marked ${type} ${id} as ${status}`);

        // Refresh the display
        if (type === 'batch' && resultData.batch) {
            renderResult({ type: 'batch', data: resultData.batch });
        } else if (type === 'order' && resultData.order) {
            renderResult({ type: 'order', data: resultData.order });
        } else {
            // fallback refresh
            handleScan(id);
        }

    } catch (err) {
        showError(err.message);
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    const el = document.getElementById("loading-indicator");
    if (show) el.classList.remove("hidden");
    else el.classList.add("hidden");
}

function showError(msg) {
    const el = document.getElementById("error-message");
    el.textContent = msg;
    el.classList.remove("hidden");
}

function showSuccess(msg) {
    const el = document.getElementById("success-message");
    el.textContent = msg;
    el.classList.remove("hidden");
}

function hideMessages() {
    document.getElementById("error-message").classList.add("hidden");
    document.getElementById("success-message").classList.add("hidden");
}
