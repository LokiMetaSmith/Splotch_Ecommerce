## 2025-03-01 - XSS in innerHTML template literals
**Vulnerability:** Unsanitized user data from server (magic link fetch results like error messages and order details) was injected directly into `.innerHTML` strings in `src/magic-login.js`.
**Learning:** Even if the server WAF attempts to block XSS payloads, defense in depth is required. The UI must safely encode output before rendering it as HTML to prevent stored and reflected XSS vulnerabilities.
**Prevention:** Always use a utility function like `escapeHtml()` when interpolating dynamic data into `.innerHTML`, or prefer using safer methods like `.textContent` or `innerText` when no HTML formatting is expected.
## 2025-03-01 - DOMPurify Missing Before SVG DOM Injection
**Vulnerability:** In `src/printshop.js`, the output from `SvgNest` was injected directly into `ui.nestedSvgContainer.innerHTML` and saved for PDF export without sanitization. While backend validation exists, malicious SVG files bypassing backend validation (or modified client-side) could lead to Stored/Reflected XSS when rendered.
**Learning:** `DOMPurify` was imported but not used. Always sanitize rich content (like SVG or HTML) generated dynamically or fetched from a server before injecting it into the DOM via `.innerHTML`.
**Prevention:** Use `DOMPurify.sanitize(content, { USE_PROFILES: { svg: true } })` to clean SVG data prior to `.innerHTML` assignment, ensuring structural integrity while removing XSS vectors.
