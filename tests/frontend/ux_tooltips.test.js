/**
 * @jest-environment jsdom
 */
import { setupTooltips } from "../../src/ux-enhancements.js";

describe("Tooltip UX", () => {
  beforeEach(() => {
    // Clean up DOM
    document.body.innerHTML = "";
  });

  test("setupTooltips creates the tooltip element", () => {
    setupTooltips();
    const tooltip = document.getElementById("custom-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip.tagName).toBe("DIV");
    expect(tooltip.classList.contains("fixed")).toBe(true);
    expect(tooltip.classList.contains("opacity-0")).toBe(true);
  });

  test("tooltip appears on mouseenter", () => {
    // Setup DOM
    const button = document.createElement("button");
    button.dataset.tooltip = "Test Tooltip";
    document.body.appendChild(button);

    setupTooltips();

    const tooltip = document.getElementById("custom-tooltip");

    // Trigger mouseenter
    const event = new MouseEvent("mouseenter");
    button.dispatchEvent(event);

    expect(tooltip.textContent).toBe("Test Tooltip");
    expect(tooltip.classList.contains("opacity-0")).toBe(false);
  });

  test("tooltip hides on mouseleave", () => {
    // Setup DOM
    const button = document.createElement("button");
    button.dataset.tooltip = "Test Tooltip";
    document.body.appendChild(button);

    setupTooltips();

    const tooltip = document.getElementById("custom-tooltip");

    // Show first
    button.dispatchEvent(new MouseEvent("mouseenter"));
    expect(tooltip.classList.contains("opacity-0")).toBe(false);

    // Hide
    button.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tooltip.classList.contains("opacity-0")).toBe(true);
  });
});
