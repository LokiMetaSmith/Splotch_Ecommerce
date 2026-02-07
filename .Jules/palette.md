## 2025-05-18 - Leveraging Existing Feedback Mechanisms
**Learning:** The app uses a single `showPaymentStatus` container for all major feedback (loading, success, error), even outside of payment contexts (e.g., image generation). This provides a consistent location for users to look for updates.
**Action:** Reuse `showPaymentStatus` for async operations like loading deep-linked content instead of creating new toast components.
