## 2024-05-16 - Tailwind Usage over Custom CSS
**Learning:** When adding focus states or other styling improvements, the codebase strongly prefers using existing Tailwind utility classes (e.g., `focus-visible:ring-2`) over injecting custom CSS into style blocks.
**Action:** Always search for equivalent Tailwind classes before falling back to custom CSS.

## 2024-05-16 - Careful with Server Test Artifacts
**Learning:** Be careful when running tests that might generate files in `server/uploads`. The `.gitignore` does not catch all test artifacts (like UUID named files), so they must be manually cleaned up or excluded from commits.
**Action:** Check `git status` carefully before committing to ensure no unintended test output files are included.
## 2026-03-04 - Explicitly Managing Disabled States for Editing Controls
**Learning:** To ensure that all image editing controls (like sliders and buttons) correctly disable when no image is loaded, their specific DOM elements must be explicitly added to the `elements` array inside the `updateEditingButtonsState` function in `src/index.js`.
**Action:** When adding new image-manipulation UI controls to `index.html`, always check `updateEditingButtonsState` to make sure they are appended to its internal `elements` list to maintain proper application state.

## 2026-03-05 - Adding Focus States for Accessibility in Utility Buttons
**Learning:** Keyboard-only users need visual feedback for interactive elements. Even simple utility buttons (like the `close-modal-btn` on modal dialogues) require explicit `focus-visible` styles to ensure usability. Without them, a user tabbing through the page won't know when the "Close" button is active.
**Action:** Always ensure custom button elements have Tailwind `focus-visible` classes (e.g., `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 rounded`) alongside their normal/hover styling so they remain fully accessible.

## 2026-03-06 - Dynamically Created Focus States
**Learning:** Components created dynamically using `document.createElement`, such as toast notifications, often lack visual focus states necessary for keyboard navigation accessibility because they don't use standard styled component templates.
**Action:** Always append Tailwind CSS's `focus-visible` utility classes (e.g., `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`) when dynamically generating interactive DOM elements to guarantee clear focus indicators for keyboard users.
## 2026-03-08 - Hiding Decorative SVGs from Screen Readers\n**Learning:** Decorative `<svg>` elements inside interactive components (like buttons) must include the `aria-hidden="true"` attribute to prevent screen readers from announcing redundant or confusing image descriptions.\n**Action:** Always add `aria-hidden="true"` to SVG icons that do not convey unique semantic meaning, especially when the parent element already has text or an `aria-label`.\n
