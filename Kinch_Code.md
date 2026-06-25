# Kinch Codebase Analysis

## Tech Stack

*   **Languages**: JavaScript, HTML, CSS, TypeScript (implied)
*   **Backend Frameworks/Libraries**: Node.js, Express.js, TinyHTTP, `@apimatic/proxy`, `http-proxy-agent`, `https-proxy-agent`
*   **Frontend Frameworks/Libraries**: Vite, Tailwind CSS, SVG.js, Clipper.js, DOMPurify, html2canvas, Square Web Payments SDK, `svg-parser`, `svgnest.js`, `geometryutil.js`, `matrix.js`, `parallel.js`, `placementworker.js`
*   **Database**: `lowdb`
*   **Authentication/Security**: JWT (JSON Web Tokens), `bcrypt`, `jsonwebtoken`, `@simplewebauthn/browser`, `@simplewebauthn/server`, `jose`, `google-auth-library`, `gaxios`, `gtoken`, `tiny-csrf`, `express-session`, `cookie-parser`, `lusca`
*   **API Interaction**: `node-fetch`, `superagent`, `axios`, `googleapis`, `gcp-metadata`
*   **File Handling**: `multer`, `formidable`, `form-data-encoder`, `formdata-node`, `file-type`, `image-size`
*   **PDF Generation**: `jspdf`, `svg-to-pdfkit`, `pdfkit`
*   **Testing**: Jest, Playwright, Supertest, `@jest/*`, `@apimatic/schema`, `jest-config`, `jest-runtime`, `jest-snapshot`, `jest-util`, `expect`, `pretty-format`, `jsdom`
*   **Utilities**: `dotenv`, `chalk`, `debug`, `qs`, `mime-types`, `semver`, `tslib`, `nanoid`, `uuid`, `yargs`, `commander`, `slash`, `sprintf-js`, `type-fest`, `graceful-fs`, `micromatch`, `path-scurry`, `inherits`, `once`, `is-callable`, `call-bind`, `get-intrinsic`, `es-errors`, `define-properties`, `hasown`, `lodash`, `ms`, `on-finished`, `on-headers`, `parseurl`, `router`, `serve-static`, `send`, `statuses`, `vary`, `accepts`, `mime-db`, `escape-html`, `escape-string-regexp`, `eta`, `http-errors`, `fs.realpath`, `picocolors`, `ajv`, `node-gyp-build`, `node-addon-api`, `@swc/helpers`, `@noble/hashes`, `@paralleldrive/cuid2`, `@levischuck/tiny-cbor`, `@peculiar/*`, `url-template`, `glob`, `minimatch`, `is-string`, `express-validator`, `express-rate-limit`
*   **Messaging/Notifications**: `nodemailer`, `node-telegram-bot-api`
*   **Build Tools**: Vite, Rollup, PostCSS, esbuild, Babel

## Project Structure

*   **Root**:
    *   `package.json`: Project configuration, dependencies, and scripts.
    *   `vite.config.js`: Vite build tool configuration.
    *   `tailwind.config.js`: Tailwind CSS configuration.
    *   `playwright.config.js`: Playwright E2E testing configuration.
    *   `jest.config.js`: Jest testing configuration.
    *   `ToDo.md`: Task tracking.
    *   `README.md`: Project overview.
    *   `index.html`: Main customer-facing page.
    *   `printshop.html`: Internal print shop dashboard.
    *   `status.html`: Status page.
    *   `magic-login.html`: Magic link login page.
    *   `orders.html`: Order history page.
    *   `styles.css`: Global CSS.
    *   `splotch-theme.css`: Custom theme CSS.
    *   `output.css`: Compiled Tailwind CSS.
    *   `verification/`: Python scripts for verification.
*   **`server/`**: Backend application code.
    *   `server.js`: Core Express server setup.
    *   `index.js`: Alternative server entry point.
    *   `bot.js`: Telegram bot logic.
    *   `email.js`: Email sending utilities.
    *   `keyManager.js`: JWT key management.
    *   `pricing.js`: Sticker pricing logic.
    *   `pricing.json`: Pricing configuration.
    *   `uploads/`: Directory for file uploads.
    *   `db.json`: `lowdb` database file.
    *   `error.log`: Server error log.
    *   `.env`: Environment variables.
    *   `cli.js`: Command-line interface for database management.
    *   `getAuthUrl.js`: Google OAuth URL generation.
    *   `getRefreshToken.js`: Google OAuth refresh token retrieval.
    *   `findId.js`: Telegram chat ID finder script.
*   **`src/`**: Frontend application code.
    *   `index.js`: Main client-side logic.
    *   `magic-login.js`: Client-side magic login logic.
    *   `orders.js`: Client-side order display logic.
    *   `printshop.js`: Core print shop frontend logic.
    *   `status.js`: Status page animation logic.
    *   `status.css`: Status page styles.
    *   `lib/`: Utility and library files.
        *   `clipper.js`: Polygon clipping library.
        *   `parallel.js`: Web worker utility.
        *   `placementworker.js`: Worker logic for placement.
        *   `geometryutil.js`: Geometric utility functions.
        *   `matrix.js`: Matrix transformation class.
        *   `svgparser.js`: SVG parsing utility.
        *   `svgnest.js`: SVG nesting logic.
        *   `square.js`: Square SDK integration.
*   **`tests/`**: Unit and integration tests.
    *   `image.test.js`: SVG parsing tests.
    *   `pricing.test.js`: Pricing calculation tests.
    *   `server.test.js`: Server integration tests.
    *   `simple.test.js`: Placeholder test.
    *   `webauthn.test.js`: WebAuthn integration tests.
*   **`node_modules/`**: Installed project dependencies.

## Commands

*   `git clone`: Repository cloning.
*   `cd server`: Navigate to server directory.
*   `npm install`: Install Node.js dependencies.
*   `npm start`: Start the Node.js server (production build or main entry).
*   `npm run dev`: Start the Vite development server.
*   `npm run build`: Build the Vite application for production.
*   `npm run test`: Run Jest unit tests.
*   `npm run test:unit`: Run Jest unit tests.
*   `npm run test:e2e`: Run Playwright end-to-end tests.
*   `npm run styles`: Build Tailwind CSS.
*   `npm run start-mock-server`: Start a JSON server for mocking.
*   `node server.js`: Start the server.
*   `node index.js`: Start the server (alternative entry).
*   `node server/cli.js <command>`: Execute CLI commands (e.g., `add-user`, `list-users`).
*   `node server/getAuthUrl.js`: Generate Google OAuth URL.
*   `node server/getRefreshToken.js`: Retrieve Google OAuth refresh token.
*   `node server/findId.js`: Find Telegram chat IDs.
*   `npx playwright test`: Run Playwright end-to-end tests.
*   `playwright install`: Install Playwright browser binaries.
*   `serve`: Start a local HTTP server for production builds.
*   `npm install -g serve`: Install `serve` globally.

## Code Style & Conventions

*   **Languages**: JavaScript (ES Modules `import`/`export`, `async`/`await`), TypeScript (implied).
*   **Naming**:
    *   Variables/Functions: `camelCase`.
    *   Classes/Components: `PascalCase`.
    *   Constants: `UPPER_SNAKE_CASE`.
    *   File Names: `kebab-case` (HTML, CSS), `camelCase` (JS).
    *   CSS Classes: `kebab-case` (e.g., `order-card`, `filter-btn`).
*   **Modularity**: Heavy reliance on modular design using JavaScript modules and npm packages.
*   **Comments**: JSDoc comments for functions, general explanations, and TODOs.
*   **Error Handling**: `try...catch` blocks, `console.error`, `throw new Error`, `process.on('unhandledRejection')`, `process.on('uncaughtException')`, logging to `error.log`.
*   **Configuration**: `.env` files for environment variables, JSON files (`pricing.json`) for configuration.
*   **Data Storage**: `lowdb` with `db.json`.
*   **DOM Manipulation**: `document.getElementById`, element creation, SVG namespace usage.
*   **State Management**: `localStorage` for tokens.
*   **Styling**: Tailwind CSS for utility classes, custom CSS variables in `splotch-theme.css` and `styles.css`.
*   **SVG Handling**: Parsing SVG paths, geometric calculations, matrix transformations, nesting algorithms.
*   **Testing**: Jest for unit/integration, Playwright for E2E.

## Repository Etiquette

*   `ToDo.md` tracks planned features and bug fixes.
*   `README.md` provides project overview.
*   `verification/verify_status_page.py` ensures status page integrity.

## Core Files & Utilities

*   **`package.json`**: Central configuration for dependencies and scripts.
*   **`vite.config.js`**: Vite build configuration.
*   **`server/server.js`**: Main backend server entry point.
*   **`src/index.js`**: Main frontend client-side logic.
*   **`src/printshop.js`**: Core print shop frontend logic.
*   **`src/lib/svgnest.js`**: SVG nesting algorithm orchestrator.
*   **`src/lib/svgparser.js`**: Parses SVG data into geometric representations.
*   **`src/lib/geometryutil.js`**: Provides geometric calculation utilities.
*   **`src/lib/matrix.js`**: Handles SVG transformation matrices.
*   **`server/pricing.js`**: Calculates sticker prices.
*   **`server/pricing.json`**: Pricing configuration data.
*   **`keyManager.js`**: Manages JWT signing keys.
*   **`bot.js`**: Telegram bot integration.
*   **`email.js`**: Email sending utilities.
*   **`tests/pricing.test.js`**: Validates pricing logic.
*   **`tests/webauthn.test.js`**: Tests WebAuthn integration.
*   **`verification/verify_status_page.py`**: Python script using Playwright to test the status page.
*   **`cli.js`**: Command-line interface for database management.

## The "Do Not Touch" List

*   No explicit "Do Not Touch" list is provided in the summaries.
*   However, core utility libraries like `src/lib/clipper.js`, `src/lib/geometryutil.js`, `src/lib/matrix.js`, and `src/lib/svgparser.js` are critical for geometric operations and should be modified with caution.
*   Configuration files like `pricing.json` and `.env` are essential for application behavior.