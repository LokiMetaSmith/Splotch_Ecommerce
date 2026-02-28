/**
 * Formats a raw phone number string into (XXX) XXX-XXXX format.
 * @param {string} value - The raw input value.
 * @returns {string} - The formatted phone number.
 */
export function formatPhoneNumber(value) {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, "");
  const phoneNumberLength = phoneNumber.length;

  if (phoneNumberLength < 4) return phoneNumber;
  if (phoneNumberLength < 7) {
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
  }
  return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
}

/**
 * Sets up phone number formatting for the #phone input field.
 */
export function setupPhoneFormatting() {
  const phoneInput = document.getElementById("phone");
  if (!phoneInput) return;

  phoneInput.addEventListener("input", (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    if (e.target.value !== formatted) {
      e.target.value = formatted;
    }
  });
}

/**
 * Sets up custom tooltips for elements with data-tooltip attribute.
 */
export function setupTooltips() {
  const tooltip = document.createElement("div");
  tooltip.id = "custom-tooltip";
  // Sticker Bubble Styling (mimicking .speech-bubble)
  // White background, Navy border/text, rounded corners, shadow.
  tooltip.className =
    "fixed z-[10000] px-3 py-2 text-xs rounded shadow-lg pointer-events-none transition-opacity duration-200 opacity-0 border-2 border-splotch-navy bg-white text-splotch-navy";
  tooltip.style.fontFamily = "var(--font-baumans)";
  tooltip.style.fontWeight = "bold";
  tooltip.style.borderColor = "var(--splotch-navy)";
  tooltip.style.color = "var(--splotch-navy)";

  // Create the arrow element
  const arrow = document.createElement("div");
  arrow.className =
    "absolute w-0 h-0 border-solid border-transparent pointer-events-none";
  // Arrow size: 8px
  arrow.style.borderWidth = "8px";
  arrow.style.left = "50%";
  arrow.style.transform = "translateX(-50%)";
  tooltip.appendChild(arrow);

  document.body.appendChild(tooltip);

  const show = (el) => {
    // Clear previous content to avoid duplicating the arrow if we append it
    // But we appended arrow once. We just need to update text.
    // Use a text node or span for content to avoid overwriting the arrow div.
    // Let's assume tooltip only has text content + arrow.
    // Actually, textContent overwrites everything.
    // So we should have a content span.

    // Check if we have a content span, if not create one
    let contentSpan = tooltip.querySelector(".tooltip-content");
    if (!contentSpan) {
      contentSpan = document.createElement("span");
      contentSpan.className = "tooltip-content";
      tooltip.insertBefore(contentSpan, arrow);
    }
    contentSpan.textContent = el.dataset.tooltip;

    // We need to display block to get dimensions? No, fixed is fine.
    // But we need to ensure it's rendered to get offsetHeight.
    // Removing opacity-0 temporarily might be needed if it was display:none,
    // but here it is just opacity.

    const rect = el.getBoundingClientRect();
    const tooltipHeight = tooltip.offsetHeight;
    const tooltipWidth = tooltip.offsetWidth;

    // Default: Position above the element with gap (8px + arrow 8px = 16px)
    let top = rect.top - tooltipHeight - 12;
    let isFlipped = false;

    // Smart Positioning: If it goes off the top (or very close), flip to below
    if (top < 10) {
      top = rect.bottom + 12;
      isFlipped = true;
    }

    tooltip.style.top = `${top}px`;
    // Center horizontally
    tooltip.style.left = `${rect.left + rect.width / 2 - tooltipWidth / 2}px`;

    // Update Arrow Orientation
    if (isFlipped) {
      // Tooltip is BELOW. Arrow should be at TOP, pointing UP.
      // Border-bottom color should be Navy.
      arrow.style.top = "-16px"; // 2 * borderWidth
      arrow.style.bottom = "auto";
      arrow.style.borderBottomColor = "var(--splotch-navy)";
      arrow.style.borderTopColor = "transparent";
    } else {
      // Tooltip is ABOVE. Arrow should be at BOTTOM, pointing DOWN.
      // Border-top color should be Navy.
      arrow.style.top = "auto";
      arrow.style.bottom = "-16px"; // 2 * borderWidth
      arrow.style.borderTopColor = "var(--splotch-navy)";
      arrow.style.borderBottomColor = "transparent";
    }

    tooltip.classList.remove("opacity-0");
  };

  const hide = () => tooltip.classList.add("opacity-0");

  const elements = document.querySelectorAll("[data-tooltip]");
  elements.forEach((el) => {
    el.addEventListener("mouseenter", () => show(el));
    el.addEventListener("mouseleave", hide);
    el.addEventListener("focus", () => show(el));
    el.addEventListener("blur", hide);
    // Add touchstart for better mobile responsiveness
    el.addEventListener("touchstart", () => show(el), { passive: true });
  });
}

let keydownListener = null;

/**
 * Sets up global keyboard shortcuts for the image editor.
 */
export function setupKeyboardShortcuts() {
  if (keydownListener) {
    document.removeEventListener("keydown", keydownListener);
  }

  // Add shortcuts to tooltips
  const shortcuts = {
    rotateLeftBtn: " ([)",
    rotateRightBtn: " (])",
    grayscaleBtn: " (g)",
    sepiaBtn: " (s)",
  };

  for (const [id, key] of Object.entries(shortcuts)) {
    const el = document.getElementById(id);
    if (el && el.dataset.tooltip) {
      el.dataset.tooltip += key;
    }
  }

  keydownListener = (e) => {
    // Ignore if typing in input
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    )
      return;

    // Ignore if modifiers (except Shift for zoom)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case "[":
        document.getElementById("rotateLeftBtn")?.click();
        break;
      case "]":
        document.getElementById("rotateRightBtn")?.click();
        break;
      case "g":
        document.getElementById("grayscaleBtn")?.click();
        break;
      case "s":
        document.getElementById("sepiaBtn")?.click();
        break;
      case "ArrowUp":
        if (e.shiftKey) {
          e.preventDefault(); // Prevent scrolling
          const slider = document.getElementById("resizeSlider");
          if (slider && !slider.disabled) {
            const step = parseFloat(slider.step) || 0.1;
            const val = parseFloat(slider.value) || 0;
            const max = parseFloat(slider.max) || 100;
            if (val + step <= max) {
              slider.value = (val + step).toFixed(1); // Keep precision
              slider.dispatchEvent(new Event("input"));
            }
          }
        }
        break;
      case "ArrowDown":
        if (e.shiftKey) {
          e.preventDefault(); // Prevent scrolling
          const slider = document.getElementById("resizeSlider");
          if (slider && !slider.disabled) {
            const step = parseFloat(slider.step) || 0.1;
            const val = parseFloat(slider.value) || 0;
            const min = parseFloat(slider.min) || 0;
            if (val - step >= min) {
              slider.value = (val - step).toFixed(1); // Keep precision
              slider.dispatchEvent(new Event("input"));
            }
          }
        }
        break;
    }
  };
  document.addEventListener("keydown", keydownListener);
}

/**
 * Creates and injects a "Keyboard Shortcuts" help modal and button.
 */
export function setupShortcutsHelp() {
  const sellBtn = document.getElementById("sellDesignBtn");
  const container = sellBtn ? sellBtn.parentNode : null;
  if (!container) return; // Only run on pages with the header structure

  // Prevent duplicate button
  if (document.getElementById("shortcutsBtn")) return;

  // Create the Help Button
  const btn = document.createElement("button");
  btn.id = "shortcutsBtn";
  btn.type = "button";
  btn.className =
    "bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors";
  btn.setAttribute("aria-label", "Show Keyboard Shortcuts");
  btn.setAttribute("title", "Keyboard Shortcuts");
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
  `;
  container.appendChild(btn);

  // Create the Modal
  const modal = document.createElement("div");
  modal.id = "shortcutsModal";
  modal.className =
    "fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 hidden transition-opacity duration-200";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "shortcutsModalTitle");

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4 transform transition-all scale-100" style="font-family: var(--font-baumans)">
      <div class="flex justify-between items-center mb-4 border-b pb-2">
        <h2 id="shortcutsModalTitle" class="text-xl font-bold text-splotch-navy">Keyboard Shortcuts</h2>
        <button type="button" class="close-modal text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-splotch-navy rounded" aria-label="Close shortcuts modal">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <span class="text-gray-700 font-medium">Rotate Left</span>
          <kbd class="px-2 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm font-mono text-gray-600 shadow-sm">[</kbd>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-gray-700 font-medium">Rotate Right</span>
          <kbd class="px-2 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm font-mono text-gray-600 shadow-sm">]</kbd>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-gray-700 font-medium">Grayscale Toggle</span>
          <kbd class="px-2 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm font-mono text-gray-600 shadow-sm">G</kbd>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-gray-700 font-medium">Sepia Toggle</span>
          <kbd class="px-2 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm font-mono text-gray-600 shadow-sm">S</kbd>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-gray-700 font-medium">Fine Tune Size</span>
          <div class="flex gap-1">
            <kbd class="px-2 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm font-mono text-gray-600 shadow-sm">Shift</kbd>
            <span class="self-center text-gray-400">+</span>
            <kbd class="px-2 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm font-mono text-gray-600 shadow-sm">↑/↓</kbd>
          </div>
        </div>
      </div>

      <div class="mt-6 text-center">
        <button type="button" class="close-modal-btn bg-splotch-navy text-white hover:brightness-110 font-bold py-2 px-6 rounded-full shadow-md transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-splotch-navy">
          Got it!
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Logic to Open/Close
  const openModal = () => {
    modal.classList.remove("hidden");
    // Trap focus inside modal? (Simple version: focus close button)
    setTimeout(() => {
      modal.querySelector(".close-modal-btn").focus();
    }, 100);
  };

  const closeModal = () => {
    modal.classList.add("hidden");
    btn.focus(); // Return focus to trigger button
  };

  btn.addEventListener("click", openModal);

  // Close on button clicks
  const closeButtons = modal.querySelectorAll(".close-modal, .close-modal-btn");
  closeButtons.forEach((b) => b.addEventListener("click", closeModal));

  // Close on click outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

// Initialize on load
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    setupPhoneFormatting();
    setupTooltips();
    setupKeyboardShortcuts();
    setupShortcutsHelp();
  });
}
