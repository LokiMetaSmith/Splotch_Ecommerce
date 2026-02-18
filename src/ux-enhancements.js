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
  // Using Tailwind utility classes for basic structure and transition.
  // Changed z-50 to z-[10000] to ensure visibility over navbar and other fixed elements.
  tooltip.className =
    "fixed z-[10000] px-3 py-2 text-xs rounded shadow-lg pointer-events-none transition-opacity duration-200 opacity-0";
  // Using inline styles for specific Splotch theme variables that might not map directly to Tailwind classes
  tooltip.style.backgroundColor = "var(--splotch-navy)";
  tooltip.style.color = "var(--splotch-white)";
  tooltip.style.fontFamily = "var(--font-baumans)";
  tooltip.style.fontWeight = "bold";
  document.body.appendChild(tooltip);

  const show = (el) => {
    tooltip.textContent = el.dataset.tooltip;
    const rect = el.getBoundingClientRect();
    const tooltipHeight = tooltip.offsetHeight;
    const tooltipWidth = tooltip.offsetWidth;

    // Default: Position above the element with an 8px gap
    let top = rect.top - tooltipHeight - 8;

    // Smart Positioning: If it goes off the top (or very close), flip to below
    if (top < 10) {
      top = rect.bottom + 8;
    }

    tooltip.style.top = `${top}px`;
    // Center horizontally
    tooltip.style.left = `${rect.left + rect.width / 2 - tooltipWidth / 2}px`;
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

// Initialize on load
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    setupPhoneFormatting();
    setupTooltips();
  });
}
