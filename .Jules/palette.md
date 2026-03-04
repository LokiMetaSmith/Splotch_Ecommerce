## 2024-05-16 - Tailwind Usage over Custom CSS
**Learning:** When adding focus states or other styling improvements, the codebase strongly prefers using existing Tailwind utility classes (e.g., `focus-visible:ring-2`) over injecting custom CSS into style blocks.
**Action:** Always search for equivalent Tailwind classes before falling back to custom CSS.

## 2024-05-16 - Careful with Server Test Artifacts
**Learning:** Be careful when running tests that might generate files in `server/uploads`. The `.gitignore` does not catch all test artifacts (like UUID named files), so they must be manually cleaned up or excluded from commits.
**Action:** Check `git status` carefully before committing to ensure no unintended test output files are included.
## 2026-03-04 - Explicitly Managing Disabled States for Editing Controls
**Learning:** To ensure that all image editing controls (like sliders and buttons) correctly disable when no image is loaded, their specific DOM elements must be explicitly added to the `elements` array inside the `updateEditingButtonsState` function in `src/index.js`.
**Action:** When adding new image-manipulation UI controls to `index.html`, always check `updateEditingButtonsState` to make sure they are appended to its internal `elements` list to maintain proper application state.
