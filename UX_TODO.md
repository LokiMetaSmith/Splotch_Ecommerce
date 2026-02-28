# Print Shop UX ToDo List

This is a list of proposed UX improvements for the Print Shop interface, ordered by impact.

- [x] **Improve Focus States:** Add visible focus rings (e.g., `focus-visible:ring-2`) to interactive elements like buttons and inputs for better keyboard accessibility.
- [ ] **Loading Spinners for Buttons:** Add inline loading spinners (or disable states) to action buttons (e.g., "Login", "Register", "Nest Stickers") to provide immediate visual feedback during async operations, replacing or supplementing the full-screen loader.
- [ ] **Enhanced Empty States:** Replace generic "Loading orders..." or "Please log in" text in the orders list with a more visually distinct and helpful empty state design.
- [ ] **Confirmation Modals for Destructive Actions:** Add a confirmation step (e.g., a native `confirm()` or a custom modal) before performing irreversible actions like changing an order status to "Canceled".
- [ ] **ARIA Attributes and Tooltips:** Ensure all icon-only buttons (like modal close buttons) have proper `aria-label` attributes and consider adding hover/focus tooltips for small utility buttons to clarify their purpose.
