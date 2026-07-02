# TODO: Layer Parsing for Print Files

This project now supports a frontend UI for users to specify custom printing layers (e.g., White Underbase, CMYK, Clear Coat) in a specific bottom-to-top stack.

To complete this feature fully, we need a backend or robust frontend component capable of actively extracting embedded layers or print areas from user-uploaded files, especially for formats that inherently support alpha/transparency or dedicated layer data.

## Requirements for the Secondary Agent

1. **Format Support:**
   - **AI (Adobe Illustrator) & PDF:** Implement a parser (or integrate a suitable library like `pdf.js` for browser or `pdf-lib`/`pdf-parse` for Node, alongside an AI parser) to extract distinct named layers.
   - **SVG:** Parse the SVG DOM to extract `<g>` elements or `<path>`s that act as distinct layers.
   - **PNG (with Alpha):** Implement an image processing function that can extract print areas (e.g., generating a "White Underbase" layer mask derived directly from the alpha channel or non-transparent pixel regions).

2. **Integration:**
   - Instead of purely relying on manual UI layer stacking, populate the UI automatically if the uploaded file contains parseable layers.
   - For formats without explicitly named layers (like PNG), auto-generate a suggested "White Underbase" based on the image bounds/alpha channel if the selected material supports it.
   - Ensure the extracted print areas can be saved and transmitted as separate image/vector assets during checkout (or compiled into a multi-page PDF payload for the print shop).

3. **Suggested Libraries:**
   - **PDF:** `pdf.js` (frontend) or `pdf-lib` (backend)
   - **SVG:** Native DOMParser (frontend) or `svg-parser` (already in package.json)
   - **Image Processing (PNG):** Canvas API (frontend) or `sharp` (backend, if added).

4. **Security & Performance:**
   - PDF/AI parsing can be heavy; consider doing this via a Web Worker or backend API endpoint instead of blocking the main thread.

Once implemented, coordinate the output of this parser with the new `customLayers` array payload in `index.js`.
