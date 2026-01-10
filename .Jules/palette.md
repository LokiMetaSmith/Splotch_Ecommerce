# Palette's Journal

## 2024-05-22 - [Initial Entry]
**Learning:** Started tracking UX improvements.
**Action:** Always check this journal for past learnings before starting.

## 2025-02-20 - Theme CSS Specificity Overrides
**Learning:** The `splotch-theme.css` file uses `!important` declarations on generic selectors like `.label` to enforce theme colors (e.g., `color: var(--splotch-navy) !important;`). This overrides standard Tailwind utility classes (like `text-red-500`) unless they also use `!important` or inline styles.
**Action:** When applying color overrides to existing semantic elements (labels, inputs), check `splotch-theme.css` first. Use inline styles with `!important` (e.g., `style="color: var(--splotch-red) !important;"`) or highly specific CSS selectors to ensure the desired color is applied.

## 2025-02-20 - Icon Ambiguity and Touch Targets
**Learning:** Replacing clear text labels with icons can confuse users if the icons are not universally understood (e.g., specific filters like Sepia). Also, removing text often shrinks the button size below accessible limits on touch devices.
**Action:** When converting to icon-only buttons:
1. Ensure the icon is universally recognized (e.g., rotate arrows) or keep the text.
2. Always add `aria-label` for screen readers.
3. Explicitly set minimum dimensions (e.g., `min-w-[44px] min-h-[44px]`) to meet WCAG touch target guidelines, as standard padding might not be enough.

## 2025-02-20 - Grid Stretching and Theme Overrides
**Learning:** Buttons in a CSS grid may default to stretching (`justify-self: stretch`), making them visually "huge" when converted from text to icon-only. Additionally, theme stylesheets (like `splotch-theme.css`) may enforce generous padding that breaks specific icon button layouts.
**Action:** For icon-only buttons in such environments:
1. Use `justify-self-center` or similar to prevent grid stretching.
2. If theme specificity is high (global `!important` on padding), use inline styles (e.g., `style="width: 3rem !important; padding: 0 !important"`) to forcefully reset box model properties for the specific component, ensuring correct dimensions (e.g., 48px/3rem) and alignment.
