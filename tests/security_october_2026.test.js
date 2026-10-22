import request from "supertest";
import { jest } from "@jest/globals";
import {
  hasNullByte,
  hasFullwidthDigitsOrDots,
  isNonCanonicalIPv4,
  validateHostnameSecurity,
  validateZipBufferHeader
} from "../server/lib/security_sanitizer.js";
import { downloadAgentArtwork } from "../server/lib/artwork_downloader.js";

describe("October 2026 Security Releases - Vulnerability Mitigations", () => {
  describe("CVE-2026-105482 - NUL Character Truncation Guard", () => {
    it("should detect null bytes in raw strings and percent-encoded values", () => {
      expect(hasNullByte("example.com\0.attacker.com")).toBe(true);
      expect(hasNullByte("example.com%00.attacker.com")).toBe(true);
      expect(hasNullByte("clean.example.com")).toBe(false);
    });

    it("should throw a security error when validating hostnames with NUL characters", () => {
      expect(() => {
        validateHostnameSecurity("https://example.com\0.attacker.com/image.png");
      }).toThrow(/Security Violation: Input contains null character/);
    });
  });

  describe("CVE-2026-105483 - Fullwidth Digits & Dots Hostname Bypass Guard", () => {
    it("should detect fullwidth Unicode digits and dots", () => {
      // Fullwidth '127.0.0.1' -> '１２７.０.０.１'
      expect(hasFullwidthDigitsOrDots("１２７.０.０.１")).toBe(true);
      expect(hasFullwidthDigitsOrDots("127.0.0.1")).toBe(false);
    });

    it("should reject hostnames containing fullwidth digits/dots", () => {
      expect(() => {
        validateHostnameSecurity("http://１２７.０.０.１/artwork.png");
      }).toThrow(/Security Violation: Hostname contains fullwidth digits/);
    });
  });

  describe("CVE-2026-106069 & CVE-2026-106072 - Non-Canonical IPv4 Format Guard", () => {
    it("should identify non-canonical IPv4 formats (hex, octal, DWORD, leading zero)", () => {
      expect(isNonCanonicalIPv4("0x7f000001")).toBe(true);
      expect(isNonCanonicalIPv4("0177.0.0.1")).toBe(true);
      expect(isNonCanonicalIPv4("2130706433")).toBe(true);
      expect(isNonCanonicalIPv4("127.000.000.001")).toBe(true);
      expect(isNonCanonicalIPv4("127.0.0.1")).toBe(false);
    });

    it("should reject non-canonical IPv4 hostnames during security validation", () => {
      expect(() => {
        validateHostnameSecurity("http://0x7f000001/sticker.png");
      }).toThrow(/Security Violation: Non-canonical IPv4 format/);

      expect(() => {
        validateHostnameSecurity("http://127.000.000.001/sticker.png");
      }).toThrow(/Security Violation: Non-canonical IPv4 format/);
    });
  });

  describe("CVE-2026-106070 - ZIP Header Validation Guard", () => {
    it("should validate proper ZIP magic bytes and reject malformed/prepended headers", () => {
      const validZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      const invalidPrefixZip = Buffer.from([0x00, 0x50, 0x4b, 0x03, 0x04]);
      const corruptZip = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      expect(validateZipBufferHeader(validZip)).toBe(true);
      expect(validateZipBufferHeader(invalidPrefixZip)).toBe(false);
      expect(validateZipBufferHeader(corruptZip)).toBe(false);
    });
  });

  describe("Artwork Downloader Integration", () => {
    it("should reject downloading artwork from URLs violating security rules", async () => {
      await expect(
        downloadAgentArtwork("http://127.000.000.001/malicious.png")
      ).rejects.toThrow(/Security Violation: Non-canonical IPv4/);

      await expect(
        downloadAgentArtwork("http://example.com\0.attacker.com/test.png")
      ).rejects.toThrow(/Security Violation: Input contains null character/);
    });
  });
});
