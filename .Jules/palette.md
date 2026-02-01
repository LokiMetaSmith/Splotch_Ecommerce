# Palette's Journal

## 2025-02-18 - Overriding Aggressive Themes
**Learning:** The `splotch-theme.css` uses `!important` on almost every property for buttons (including background, border, and shadow), making standard utility classes (Tailwind) ineffective for dynamic state changes.
**Action:** When implementing interactive states (like toggles) on legacy-themed elements, use `element.style.setProperty('prop', 'value', 'important')` to ensure the active state visually takes precedence over the static theme.

## 2025-02-18 - Implicit Form Submission
**Learning:** Buttons placed inside a `<form>` tag default to `type="submit"`, causing page reloads when clicked for client-side interactions (like resizing). This disrupts the user experience and clears state.
**Action:** Always explicitly add `type="button"` to any interactive button inside a form that shouldn't submit the form.

## 2025-02-19 - Visual Focus on Custom Interactivity
**Learning:** Custom interactive elements (like `div`s with `role="button"`) do not receive default browser focus rings. This makes them invisible to keyboard users even if they have `tabindex="0"`.
**Action:** Explicitly add `focus-visible` styles (e.g., `focus-visible:ring-4`) to any custom interactive element.

## 2025-02-19 - Dynamic Pricing Announcements
**Learning:** Sighted users see price updates immediately, but screen reader users miss these changes if they occur outside their current focus.
**Action:** Use `aria-live="polite"` on pricing or status display containers to ensure updates are announced without interrupting the user's flow.

## 2025-02-21 - Accessible Dynamic Units
**Learning:** Standard range inputs announce numeric values but miss context when units change dynamically (e.g., inches vs mm).
**Action:** Synchronize `aria-valuetext` on `input[type="range"]` with the visual display text whenever the value or unit changes to ensure screen readers announce the full context.

## 2025-02-24 - Modal Focus Management
**Learning:** Modals implemented with simple visibility toggles (like `.hidden`) often trap focus or fail to restore it, leaving keyboard users lost.
**Action:** When opening a modal, save `document.activeElement` and move focus to the modal's first input. When closing, restore focus to the saved element. Always map `Escape` to close.

## 2025-05-21 - Skip Link Targets
**Learning:** Anchor links (skip links) targeting non-interactive elements (like divs/sections) do not move keyboard focus unless the target has `tabindex="-1"`.
**Action:** Always add `tabindex="-1"` and `outline-none` (if visual ring is unwanted) to container elements targeted by skip links.
