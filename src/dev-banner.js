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
  const bannerRectHeight = banner.offsetHeight || (banner.getBoundingClientRect ? banner.getBoundingClientRect().height : 0);
  if (topMenuBar) {
    topMenuBar.style.top = bannerRectHeight > 0 ? `${bannerRectHeight}px` : '3.5rem';
  }

  // Adjust body top padding so content is not obscured
  const currentPt = window.getComputedStyle(document.body).paddingTop;
  const currentPtPx = parseFloat(currentPt) || 0;
  const addedPad = bannerRectHeight > 0 ? bannerRectHeight : 38;
  document.body.style.setProperty('padding-top', `${currentPtPx + addedPad}px`, 'important');
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

  if (!isSandbox) {
    if (banner) {
      banner.classList.add("hidden");
      banner.style.display = "none";
      banner.innerHTML = "";
    }
    if (cardHint) {
      cardHint.classList.add("hidden");
      cardHint.style.display = "none";
      cardHint.innerHTML = "";
    }
    if (section) {
      section.classList.remove("ring-4", "ring-amber-400", "border-2", "border-amber-500", "bg-amber-50/20");
    }
    return;
  }

  if (banner) {
    if (!document.getElementById("copyTestCardBtn")) {
      banner.innerHTML = `
        <div class="h-3 w-full" style="background: repeating-linear-gradient(-45deg, #f59e0b, #f59e0b 12px, #1f2937 12px, #1f2937 24px);"></div>
        <div class="p-4 sm:p-5">
          <div class="flex items-start gap-3 sm:gap-4">
            <div class="flex-shrink-0 text-3xl select-none" aria-hidden="true">🚧</div>
            <div class="flex-grow min-w-0">
              <div class="flex flex-wrap items-center gap-2 mb-1.5">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-200 text-amber-900 border border-amber-300">
                  ⚠️ Sandbox Mode
                </span>
                <span class="text-sm sm:text-base font-bold text-amber-950">
                  Simulated Payment Environment
                </span>
              </div>
              <p class="text-xs sm:text-sm text-amber-900 leading-relaxed mb-3">
                This store is currently connected to <strong>Square Sandbox</strong> (<code class="bg-amber-100 px-1 py-0.5 rounded font-mono text-xs">SQUARE_ENVIRONMENT="sandbox"</code>). Transactions are simulated: <strong>no real cards will be charged, and physical stickers will NOT be printed or shipped.</strong>
              </p>
              <div class="bg-white/95 border border-amber-300 rounded-md p-3.5 shadow-sm text-xs sm:text-sm text-gray-800">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span class="font-bold text-gray-800 flex items-center gap-1.5">
                    <span>💳</span>
                    <span>Official Square Test Card:</span>
                  </span>
                  <button type="button" id="copyTestCardBtn" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-900 border border-amber-300 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer" title="Click to copy test card number">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    <span id="copyTestCardText">Copy Card Number</span>
                  </button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-1 border-t border-amber-100 text-xs">
                  <div>
                    <span class="text-gray-500 block">Card Number</span>
                    <code class="font-mono font-bold text-gray-900 bg-amber-50 px-1.5 py-0.5 rounded select-all text-xs sm:text-sm" id="testCardNumberDisplay">4111 1111 1111 1111</code>
                  </div>
                  <div>
                    <span class="text-gray-500 block">Exp Date</span>
                    <span class="font-medium text-gray-800">Any future (e.g. 12/28)</span>
                  </div>
                  <div>
                    <span class="text-gray-500 block">CVV</span>
                    <span class="font-medium text-gray-800">Any 3 digits (e.g. 123)</span>
                  </div>
                  <div>
                    <span class="text-gray-500 block">Postal Code</span>
                    <span class="font-medium text-gray-800">Any valid (e.g. 73101)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="h-1.5 w-full" style="background: repeating-linear-gradient(-45deg, #f59e0b, #f59e0b 12px, #1f2937 12px, #1f2937 24px);"></div>
      `;
    }
    banner.classList.remove("hidden");
    banner.style.display = "block";
  }

  if (cardHint) {
    if (!cardHint.innerHTML.trim()) {
      cardHint.innerHTML = `
        <span class="text-sm" aria-hidden="true">⚠️</span>
        <span>Square Sandbox Active: Use test card <code class="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-200 select-all">4111 1111 1111 1111</code> below</span>
      `;
    }
    cardHint.classList.remove("hidden");
    cardHint.style.display = "flex";
  }

  if (section) {
    section.classList.add("ring-4", "ring-amber-400", "border-2", "border-amber-500", "bg-amber-50/20");
  }

  const copyBtn = document.getElementById("copyTestCardBtn");
  const copyText = document.getElementById("copyTestCardText");

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

