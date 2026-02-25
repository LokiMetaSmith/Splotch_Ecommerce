/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { setupTooltips } from "../../src/ux-enhancements.js";

describe("Enhanced Tooltip UX", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  test("tooltip appears on touchstart", () => {
    const button = document.createElement("button");
    button.dataset.tooltip = "Touch Me";
    document.body.appendChild(button);

    setupTooltips();

    const tooltip = document.getElementById("custom-tooltip");

    // Trigger touchstart
    const event = new Event("touchstart");
    button.dispatchEvent(event);

    expect(tooltip.querySelector(".tooltip-content").textContent).toBe("Touch Me");
    expect(tooltip.classList.contains("opacity-0")).toBe(false);
    // Verify styling (Bubble)
    expect(tooltip.classList.contains("bg-white")).toBe(true);
    expect(tooltip.classList.contains("text-splotch-navy")).toBe(true);
  });

  test("tooltip flips to bottom if near top edge", () => {
    const button = document.createElement("button");
    button.dataset.tooltip = "Top Button";
    document.body.appendChild(button);

    setupTooltips();
    const tooltip = document.getElementById("custom-tooltip");

    // Mock tooltip dimensions
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 30 });
    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: 100 });

    // Mock button position near top (top: 5)
    // Default calculation: top - height - 12 = 5 - 30 - 12 = -37.
    // Logic should flip to bottom + 12 = 25 + 12 = 37.
    jest.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 25,
        left: 50,
        width: 20,
        height: 20,
        right: 70
    });

    // Trigger show
    button.dispatchEvent(new Event("mouseenter"));

    expect(tooltip.style.top).toBe("37px");
  });

  test("tooltip stays on top if enough space", () => {
    const button = document.createElement("button");
    button.dataset.tooltip = "Middle Button";
    document.body.appendChild(button);

    setupTooltips();
    const tooltip = document.getElementById("custom-tooltip");

    // Mock tooltip dimensions
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 30 });

    // Mock button position (top: 100)
    // Default calculation: 100 - 30 - 12 = 58. > 10, so no flip.
    jest.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 120,
        left: 50,
        width: 20,
        height: 20,
        right: 70
    });

    // Trigger show
    button.dispatchEvent(new Event("mouseenter"));

    expect(tooltip.style.top).toBe("58px");
  });
});
