# Palette's Journal

## 2025-02-18 - Overriding Aggressive Themes
**Learning:** The `splotch-theme.css` uses `!important` on almost every property for buttons (including background, border, and shadow), making standard utility classes (Tailwind) ineffective for dynamic state changes.
**Action:** When implementing interactive states (like toggles) on legacy-themed elements, use `element.style.setProperty('prop', 'value', 'important')` to ensure the active state visually takes precedence over the static theme.
