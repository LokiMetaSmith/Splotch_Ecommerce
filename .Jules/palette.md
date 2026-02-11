## 2025-05-18 - Leveraging Existing Feedback Mechanisms
**Learning:** The app uses a single `showPaymentStatus` container for all major feedback (loading, success, error), even outside of payment contexts (e.g., image generation). This provides a single location for users to look for updates.
**Action:** Reuse `showPaymentStatus` for async operations like loading deep-linked content instead of creating new toast components.

## 2026-02-08 - Native Form Behavior for Login
**Learning:** Wrapping input fields in a `<form>` element is critical for accessibility and standard behavior (like submitting with the Enter key). Even if AJAX is used for submission, the form element provides semantic meaning and browser-native functionality that users expect.
**Action:** Always check if input groups that function as a form are actually wrapped in a `<form>` tag.

## 2026-02-09 - Inconsistent ARIA Live Regions
**Learning:** Status messages across the app (e.g., `printshop.html` vs `orders.html`) inconsistently use `aria-live`. While some have it, others rely on visual updates only, leaving screen reader users unaware of dynamic content changes like login status.
**Action:** Always verify dynamic status containers (loading, success, error) have `role="status"` and `aria-live="polite"` to ensure inclusive feedback.
