/**
 * Utility functions for sanitizing and validating hostnames, URLs, and binary streams
 * against security edge cases in Node.js (including October 2026 Security Release CVEs).
 */

/**
 * Checks if a string contains NUL / null byte characters or %00 encodings.
 * (CVE-2026-105482)
 * @param {string} input
 * @returns {boolean}
 */
export function hasNullByte(input) {
  if (typeof input !== "string") return false;
  return /\x00|\u0000|%00/.test(input);
}

/**
 * Checks if a string contains fullwidth digits (0-9: \uFF10-\uFF19) or fullwidth dots (\uFF0E, \uFF61).
 * (CVE-2026-105483)
 * @param {string} input
 * @returns {boolean}
 */
export function hasFullwidthDigitsOrDots(input) {
  if (typeof input !== "string") return false;
  return /[\uFF10-\uFF19\uFF0E\uFF61]/.test(input);
}

/**
 * Checks if a given host string represents a non-canonical IPv4 address
 * (such as octal, hexadecimal, dword integer, or leading zeros).
 * (CVE-2026-106069 & CVE-2026-106072)
 * @param {string} host
 * @returns {boolean}
 */
export function isNonCanonicalIPv4(host) {
  if (typeof host !== "string") return false;
  const trimmed = host.trim();

  // If hex representation (e.g. 0x7f000001 or 0x7f.0.0.1)
  if (/0x[0-9a-fA-F]+/i.test(trimmed)) return true;

  // Single integer DWORD format (e.g. 2130706433)
  if (/^\d+$/.test(trimmed)) return true;

  // Dotted notation check
  if (/^[\d\.]+$|^0x/i.test(trimmed)) {
    const parts = trimmed.split(".");
    if (parts.length === 4) {
      for (const part of parts) {
        // Leading zero in non-zero number (octal / padded decimal: e.g. "0177" or "01")
        if (/^0\d+/.test(part)) return true;
        // Hex in dotted format
        if (/^0x/i.test(part)) return true;
        // Out of range decimal (> 255)
        const num = parseInt(part, 10);
        if (isNaN(num) || num < 0 || num > 255) return true;
      }
    } else if (parts.length > 0 && parts.length < 4) {
      // Shortened dotted IPv4 format (e.g., 127.1)
      return true;
    }
  }

  return false;
}

/**
 * Validates whether a hostname or URL host is safe from October 2026 security release vulnerabilities.
 * @param {string} hostOrUrl
 * @returns {boolean}
 * @throws {Error} if invalid or malformed
 */
export function validateHostnameSecurity(hostOrUrl) {
  if (!hostOrUrl || typeof hostOrUrl !== "string") {
    throw new Error("Invalid input: string required");
  }

  if (hasNullByte(hostOrUrl)) {
    throw new Error("Security Violation: Input contains null character or NUL byte sequence (CVE-2026-105482)");
  }

  if (hasFullwidthDigitsOrDots(hostOrUrl)) {
    throw new Error("Security Violation: Hostname contains fullwidth digits or characters (CVE-2026-105483)");
  }

  // Check raw string host portion before URL constructor normalizes IP representations
  let rawHost = hostOrUrl;
  if (hostOrUrl.includes("://")) {
    const doubleSlashIdx = hostOrUrl.indexOf("://");
    const rest = hostOrUrl.slice(doubleSlashIdx + 3);
    const slashIdx = rest.search(/[\/\?\#:]/);
    rawHost = slashIdx !== -1 ? rest.slice(0, slashIdx) : rest;
  }

  if (isNonCanonicalIPv4(rawHost)) {
    throw new Error("Security Violation: Non-canonical IPv4 format detected (CVE-2026-106069/CVE-2026-106072)");
  }

  let hostCandidate = rawHost;
  try {
    if (hostOrUrl.includes("://")) {
      const parsed = new URL(hostOrUrl);
      hostCandidate = parsed.hostname;
    }
  } catch (err) {
    if (hasNullByte(hostOrUrl) || hasFullwidthDigitsOrDots(hostOrUrl)) {
      throw new Error("Security Violation: Malformed hostname/URL sequence");
    }
  }

  if (isNonCanonicalIPv4(hostCandidate)) {
    throw new Error("Security Violation: Non-canonical IPv4 format detected (CVE-2026-106069/CVE-2026-106072)");
  }

  return true;
}

/**
 * Validates a ZIP archive buffer to ensure valid ZIP header magic bytes and no attacker prefix padding.
 * (CVE-2026-106070)
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function validateZipBufferHeader(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }
  // Check for standard ZIP signature: PK\x03\x04 (0x50 0x4B 0x03 0x04) at index 0
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}
