## 2025-05-18 - Leveraging Existing Feedback Mechanisms
**Learning:** The app uses a single `showPaymentStatus` container for all major feedback (loading, success, error), even outside of payment contexts (e.g., image generation). This provides a single location for users to look for updates.
**Action:** Reuse `showPaymentStatus` for async operations like loading deep-linked content instead of creating new toast components.

## 2026-02-08 - Native Form Behavior for Login
**Learning:** Wrapping input fields in a `<form>` element is critical for accessibility and standard behavior (like submitting with the Enter key). Even if AJAX is used for submission, the form element provides semantic meaning and browser-native functionality that users expect.
**Action:** Always check if input groups that function as a form are actually wrapped in a `<form>` tag.

## 2026-02-09 - Inconsistent ARIA Live Regions
**Learning:** Status messages across the app (e.g., `printshop.html` vs `orders.html`) inconsistently use `aria-live`. While some have it, others rely on visual updates only, leaving screen reader users unaware of dynamic content changes like login status.
**Action:** Always verify dynamic status containers (loading, success, error) have `role="status"` and `aria-live="polite"` to ensure inclusive feedback.

## 2026-02-13 - Font Preview in Select Dropdowns
**Learning:** Adding `style="font-family: ..."` to `<option>` elements in a font selector is a low-effort, high-impact UX improvement that allows users to preview typefaces immediately without selecting them first.
**Action:** When implementing font selection tools, always attempt to display the font name in its own typeface within the selection interface.

## 2026-02-15 - Input Masking
**Learning:** Simple input masking (like for phone numbers) significantly reduces cognitive load and formatting errors without requiring heavy libraries.
**Action:** Implement lightweight masking for structured inputs whenever possible.

## 2026-02-20 - Skip Link Visibility with Fixed Headers
**Learning:** When using fixed headers like `.top-menu-bar`, a simple static skip link might be hidden behind the header or fail to scroll properly. The combination of absolute positioning, high z-index, and explicit scroll targeting is crucial.
**Action:** Always verify skip link visibility and functionality against fixed headers.

## 2026-02-27 - Focus Management on Hiding Elements
**Learning:** Hiding an element that currently has focus (e.g., via `display: none` or `.hidden` class) resets focus to the `body`, disrupting keyboard navigation and forcing users to tab from the beginning of the document.
**Action:** Always programmatically move focus to a logical next interactive element (e.g., an input or adjacent button) immediately after hiding the active element.
## 2025-02-28 - Missing `aria-label`s on Dynamically Generated Icon-Only Close Buttons
**Learning:** Icon-only close buttons (like the `&times;` or SVG cross) inside dynamically generated JavaScript modals are frequently overlooked when applying `aria-label`s and focus states (`focus-visible:ring-2`), creating accessibility barriers for screen-reader users and keyboard navigators.
**Action:** When creating or reviewing UI components rendered via string templates in JavaScript, proactively verify that any icon-only buttons include an explicit `aria-label` describing the action, and feature distinct `focus-visible` styles for keyboard navigation.
