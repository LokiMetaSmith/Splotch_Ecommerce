import { formatPhoneNumber } from '../../src/ux-enhancements.js';

describe('Phone Number Formatting', () => {
  test('returns original value if empty', () => {
    expect(formatPhoneNumber('')).toBe('');
    expect(formatPhoneNumber(null)).toBe(null);
  });

  test('returns raw digits if length < 4', () => {
    expect(formatPhoneNumber('1')).toBe('1');
    expect(formatPhoneNumber('123')).toBe('123');
  });

  test('formats area code', () => {
    expect(formatPhoneNumber('1234')).toBe('(123) 4');
    expect(formatPhoneNumber('123456')).toBe('(123) 456');
  });

  test('formats full number', () => {
    expect(formatPhoneNumber('1234567')).toBe('(123) 456-7');
    expect(formatPhoneNumber('1234567890')).toBe('(123) 456-7890');
  });

  test('ignores extra digits beyond 10', () => {
    // Current implementation drops characters after index 10
    expect(formatPhoneNumber('12345678901')).toBe('(123) 456-7890');
  });

  test('handles non-numeric input', () => {
    expect(formatPhoneNumber('a1b2c3')).toBe('123');
    expect(formatPhoneNumber('(123) 456-7890')).toBe('(123) 456-7890');
  });
});
