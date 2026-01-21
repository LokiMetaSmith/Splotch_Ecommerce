# Palette's Journal

## 2025-02-18 - Overriding Aggressive Themes
**Learning:** The `splotch-theme.css` uses `!important` on almost every property for buttons (including background, border, and shadow), making standard utility classes (Tailwind) ineffective for dynamic state changes.
**Action:** When implementing interactive states (like toggles) on legacy-themed elements, use `element.style.setProperty('prop', 'value', 'important')` to ensure the active state visually takes precedence over the static theme.

## 2025-02-18 - Implicit Form Submission
**Learning:** Buttons placed inside a `<form>` tag default to `type="submit"`, causing page reloads when clicked for client-side interactions (like resizing). This disrupts the user experience and clears state.
**Action:** Always explicitly add `type="button"` to any interactive button inside a form that shouldn't submit the form.
