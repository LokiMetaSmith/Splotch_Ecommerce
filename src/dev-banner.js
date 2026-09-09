/**
 * Development Mode Warning Banner
 * Displays a prominent banner when the application is running in development mode (NODE_ENV=development)
 * to prevent users/testers from expecting real order fulfillment.
 */

export function renderDevBanner(isDev = true) {
  if (!isDev) return;

  // Prevent duplicate banners
  if (document.getElementById('dev-mode-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'dev-mode-banner';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'polite');

  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    z-index: 10000;
    background: linear-gradient(90deg, #b45309 0%, #d97706 50%, #b45309 100%);
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    box-sizing: border-box;
    text-align: center;
  `;

  banner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; max-width: 1200px; margin: 0 auto;">
      <span style="display: inline-flex; align-items: center; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.4); padding: 2px 8px; border-radius: 4px; font-size: 11px; letter-spacing: 0.8px; font-weight: 800; text-transform: uppercase;">
        ⚠️ Test / Dev Environment
      </span>
      <span>
        <strong>NODE_ENV="development" enabled:</strong> Real transactions are disabled. Orders placed here will <u>not</u> be printed, charged, or fulfilled.
      </span>
    </div>
  `;

  document.body.prepend(banner);

  // Adjust top navigation bar on pages with fixed headers (e.g. index.html)
  const topMenuBar = document.querySelector('.top-menu-bar');
  if (topMenuBar) {
    topMenuBar.style.top = '3.5rem';
  }

  // Adjust body top padding so content is not obscured
  const currentPt = window.getComputedStyle(document.body).paddingTop;
  const currentPtPx = parseFloat(currentPt) || 0;
  document.body.style.paddingTop = `${currentPtPx + 38}px`;
}

export async function checkAndRenderDevBanner(serverUrl = '') {
  try {
    const res = await fetch(`${serverUrl}/api/config`);
    if (res.ok) {
      const config = await res.json();
      if (config.isDevelopment || config.nodeEnv === 'development') {
        renderDevBanner(true);
      }
    }
  } catch (e) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      renderDevBanner(true);
    }
  }
}

/**
 * Square Sandbox Payment Banner & Highlight
 * When SQUARE_ENVIRONMENT is 'sandbox', activates a prominent construction/caution
 * banner around the payment section, highlights the payment section, reminds users
 * that physical stickers will not be fulfilled, and suggests the official test card (4111 1111 1111 1111).
 */
export function initSquareSandboxBanner(isSandbox = true) {
  const banner = document.getElementById("square-sandbox-banner");
  const section = document.getElementById("payment-details-section");
  const cardHint = document.getElementById("card-sandbox-hint");
  const copyBtn = document.getElementById("copyTestCardBtn");
  const copyText = document.getElementById("copyTestCardText");

  if (!isSandbox) {
    if (banner) {
      banner.classList.add("hidden");
      banner.style.display = "none";
    }
    if (cardHint) {
      cardHint.classList.add("hidden");
      cardHint.style.display = "none";
    }
    if (section) {
      section.classList.remove("ring-4", "ring-amber-400", "border-2", "border-amber-500", "bg-amber-50/20");
    }
    return;
  }

  if (banner) {
    banner.classList.remove("hidden");
    banner.style.display = "block";
  }
  if (cardHint) {
    cardHint.classList.remove("hidden");
    cardHint.style.display = "flex";
  }
  if (section) {
    section.classList.add("ring-4", "ring-amber-400", "border-2", "border-amber-500", "bg-amber-50/20");
  }

  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.dataset.bound = "true";
    copyBtn.addEventListener("click", async () => {
      const cardNum = "4111 1111 1111 1111";
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(cardNum);
          copied = true;
        }
      } catch (e) {
        // Fallback below
      }

      if (!copied) {
        try {
          const tempInput = document.createElement("input");
          tempInput.value = cardNum;
          document.body.appendChild(tempInput);
          tempInput.select();
          document.execCommand("copy");
          document.body.removeChild(tempInput);
          copied = true;
        } catch (err) {
          console.warn("[CLIENT] Could not copy test card:", err);
        }
      }

      if (copied && copyText) {
        const original = copyText.textContent;
        copyText.textContent = "Copied!";
        setTimeout(() => {
          copyText.textContent = original;
        }, 2000);
      }
    });
  }
}

