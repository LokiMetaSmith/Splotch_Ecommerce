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
  arrow.className = "absolute w-0 h-0 border-solid border-transparent pointer-events-none";
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

// Initialize on load
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    setupPhoneFormatting();
    setupTooltips();
  });
}
