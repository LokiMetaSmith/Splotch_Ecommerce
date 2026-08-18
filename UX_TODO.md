# Print Shop UX ToDo List

This is a list of proposed UX improvements for the Print Shop interface, ordered by impact.

- [x] **Improve Focus States:** Add visible focus rings (e.g., `focus-visible:ring-2`) to interactive elements like buttons and inputs for better keyboard accessibility.
- [x] **Loading Spinners for Buttons:** Add inline loading spinners (or disable states) to action buttons (e.g., "Login", "Register", "Nest Stickers") to provide immediate visual feedback during async operations, replacing or supplementing the full-screen loader.
- [x] **Enhanced Empty States:** Replace generic "Loading orders..." or "Please log in" text in the orders list with a more visually distinct and helpful empty state design.
- [x] **Confirmation Modals for Destructive Actions:** Add a confirmation step (e.g., a native `confirm()` or a custom modal) before performing irreversible actions like changing an order status to "Canceled".
- [x] **ARIA Attributes and Tooltips:** Ensure all icon-only buttons (like modal close buttons) have proper `aria-label` attributes and consider adding hover/focus tooltips for small utility buttons to clarify their purpose.

## Sticker Editor & Cropping UX
- [x] **Bug Fix: Image Dragging & Cutline:** Bind the red cutline's position to the image's (x, y) coordinates during the drag event so they move together.

## General Editor UX Improvements
- [x] **Visual Feedback:** Add a loading spinner or progress bar to the [GENERATE SMART CUTLINE] button.
- [x] **Information Architecture:** Group settings better (e.g. "Shape/Size" for Magic Edge, "Detail/Smoothing" for Sensitivity and Lasso).
- [x] **Tooltips:** Add (i) icons with tooltips explaining technical terms like "Lazy Lasso".
- [x] **Contrast Toggle:** Add a button to toggle the canvas background between light, dark, and transparent to help see edges better.
- [x] **Manual Node Editing (Advanced):** Supported via SVG export of cut paths. Users can edit these in external tools (e.g., Illustrator, Inkscape) and upload custom layers (like white and clear) back to the application.

## New E-commerce & Printer Management Features (From Report)

### Phase 1: Tracking & Quick Management (Current Priority)
- [x] **QR Code Integration:** Add QR codes for Order IDs to the UI and export files.
- [x] **Scan-to-Update Workflow:** Create a quick way to scan a printed QR code to instantly update an order's status.
- [x] **Printed Traveler/Margin QR:** Inject QR codes directly into the margin/waste area of the nested PDF/SVG files.
