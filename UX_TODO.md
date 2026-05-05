# Print Shop UX ToDo List

This is a list of proposed UX improvements for the Print Shop interface, ordered by impact.

- [x] **Improve Focus States:** Add visible focus rings (e.g., `focus-visible:ring-2`) to interactive elements like buttons and inputs for better keyboard accessibility.
- [x] **Loading Spinners for Buttons:** Add inline loading spinners (or disable states) to action buttons (e.g., "Login", "Register", "Nest Stickers") to provide immediate visual feedback during async operations, replacing or supplementing the full-screen loader.
- [x] **Enhanced Empty States:** Replace generic "Loading orders..." or "Please log in" text in the orders list with a more visually distinct and helpful empty state design.
- [x] **Confirmation Modals for Destructive Actions:** Add a confirmation step (e.g., a native `confirm()` or a custom modal) before performing irreversible actions like changing an order status to "Canceled".
- [x] **ARIA Attributes and Tooltips:** Ensure all icon-only buttons (like modal close buttons) have proper `aria-label` attributes and consider adding hover/focus tooltips for small utility buttons to clarify their purpose.

## Sticker Editor & Cropping UX
- [x] **Bug Fix: Image Dragging & Cutline:** Bind the red cutline's position to the image's (x, y) coordinates during the drag event so they move together.
- [ ] **Clipping Logic (Print Window):** Implement a rectangular clip-path based on the fixed Bounding Box dimensions to visually mask the image outside the box.
- [ ] **Path Boolean Operation:** Ensure the generated SVG cutline is intersected with the Bounding Box edges so it has flat edges when a breach occurs.
- [ ] **UX Enhancement (Safety Zone):** Add a subtle visual hint (like a "Safety Zone") that appears when the image is dragged near or past the bounding box edges.

## General Editor UX Improvements
- [ ] **Visual Feedback:** Add a loading spinner or progress bar to the [GENERATE SMART CUTLINE] button.
- [ ] **Real-time Preview:** If possible, decouple the sliders to update the cutline in real-time as the user scrubs them.
- [ ] **Information Architecture:** Group settings better (e.g. "Shape/Size" for Magic Edge, "Detail/Smoothing" for Sensitivity and Lasso).
- [ ] **Tooltips:** Add (i) icons with tooltips explaining technical terms like "Lazy Lasso".
- [ ] **Smart Presets:** Add preset buttons (Tight, Bubble, Smooth) for one-click configuration of edge and sensitivity sliders.
- [ ] **Contrast Toggle:** Add a button to toggle the canvas background between light, dark, and transparent to help see edges better.
- [ ] **Manual Node Editing (Advanced):** Allow users to click and drag specific points on the generated path to tweak the cutline.
