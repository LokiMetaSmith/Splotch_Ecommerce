## 2024-02-18 - Insecure Randomness in File Uploads
**Vulnerability:** The application was using `Date.now() + Math.random()` to generate filenames for uploaded files. `Math.random()` is not cryptographically secure, and the timestamp makes the filename predictable. This could allow an attacker to guess filenames and potentially access or overwrite other users' uploaded designs (Insecure Direct Object Reference / Privacy Leak).
**Learning:** Developers often reach for `Math.random()` for uniqueness, not realizing the security implications when that uniqueness protects sensitive data (like user uploads). `multer`'s default `diskStorage` documentation examples often show this insecure pattern, propagating it.
**Prevention:** Always use `crypto.randomUUID()` (or `uuid` v4) for generating identifiers that need to be unpredictable and unique. Avoid `Math.random()` for any ID generation that is exposed to users or used for security decisions.

## 2024-05-23 - Rate Limiting Regression in Tests
**Vulnerability:** Lack of strict rate limiting on authentication endpoints (`/api/auth/*`) allowed potential brute-force attacks.
**Learning:** Implementing strict rate limiting (e.g., 5-10 requests/15 min) breaks integration tests that simulate multiple user interactions in a short period (like `server/auth.test.js`). Simply applying a global rate limiter without environment awareness causes CI/CD failures.
**Prevention:** When adding rate limiting, always include logic to relax or disable it in the test environment (e.g., check `NODE_ENV === 'test'`). For security tests that *verify* the rate limiter, use a specific environment variable (e.g., `ENABLE_RATE_LIMIT_TEST`) to forcefully enable the strict limit only for that test suite. This ensures both functional tests pass and the security control is verifiable.

## 2025-06-12 - Price Manipulation via Unverified Client Input
**Vulnerability:** The `/api/create-order` endpoint accepted `amountCents` directly from the client without verifying it against the product's price or creator profit margin. This allowed attackers to purchase high-value items (potentially worth hundreds of dollars in creator profit) for 1 cent, effectively stealing funds from the platform.
**Learning:** Trusting client-side calculations for financial transactions is a classic but persistent vulnerability. In complex pricing models (e.g., area-based pricing), it is tempting to rely on the client's output, but this creates a massive trust gap.
**Prevention:** Always recalculate prices on the server using trusted inputs (e.g., product config from DB). If full recalculation is expensive or complex, implement at least a "sanity check" or minimum threshold (e.g., `amount >= min_base_cost + creator_profit`) to prevent egregious abuse.

## 2026-01-26 - Premature Key Rotation Vulnerability
**Vulnerability:** The server rotated signing keys every hour and strictly removed keys older than 1 hour. However, JWTs were also issued with a 1-hour lifetime. This created a race condition where a token signed late in a key's lifecycle (e.g., at 50 minutes) would be valid for another hour, but the key to verify it would be deleted 10 minutes later. This caused intermittent authentication failures for valid users.
**Learning:** Key retention policies must always exceed the maximum lifetime of any artifact signed by those keys. If a token lives for X, the key must live for X + Rotation_Interval + Buffer.
**Prevention:** Decouple `ROTATION_INTERVAL` from `RETENTION_PERIOD`. Ensure `RETENTION_PERIOD >= ROTATION_INTERVAL + TOKEN_LIFETIME`.
