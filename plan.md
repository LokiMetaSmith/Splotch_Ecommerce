1. **Update `vite.config.js`**
   - Import `fs` to read `package.json`.
   - Add `__APP_VERSION__: JSON.stringify(packageJson.version)` to Vite's environment variables using the `define` option.
2. **Update HTML footers**
   - Add a span element to the footers of the relevant HTML files (`index.html`, `printshop.html`, `magic-login.html`, `orders.html`, `terms.html`) to display the version number. Give it an ID `app-version-display`.
   - E.g.: `<span class="text-xs text-gray-400 ml-2">v<span id="app-version-display"></span></span>`
3. **Update JavaScript to populate the version**
   - Create a small new script `src/version.js` that sets the text content of `app-version-display` to `__APP_VERSION__`.
   - Inject `<script type="module" src="./src/version.js" defer></script>` (or `/src/version.js` as appropriate) into the `<head>` or `<body>` of all HTML files that have a footer.
4. **Test the changes**
   - Run `pnpm build` to verify the build completes.
   - Run `pnpm run test:unit` and `pnpm run test:e2e` to ensure no tests are broken.
5. **Complete pre commit steps**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
6. **Submit changes**
