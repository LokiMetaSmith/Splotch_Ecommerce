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

  test('formats 11-digit numbers starting with 1 or +1 correctly', () => {
    expect(formatPhoneNumber('14052557889')).toBe('1 (405) 255-7889');
    expect(formatPhoneNumber('+14052557889')).toBe('+1 (405) 255-7889');
    expect(formatPhoneNumber('1-405-255-7889')).toBe('1 (405) 255-7889');
    expect(formatPhoneNumber('+1')).toBe('+1');
    expect(formatPhoneNumber('+1405')).toBe('+1 (405');
  });

  test('ignores extra digits beyond max length', () => {
    // 10-digit number ignores digits beyond 10
    expect(formatPhoneNumber('234567890199')).toBe('(234) 567-8901');
    // 11-digit number starting with 1 ignores digits beyond 11
    expect(formatPhoneNumber('1405255788999')).toBe('1 (405) 255-7889');
  });

  test('handles non-numeric input', () => {
    expect(formatPhoneNumber('a1b2c3')).toBe('123');
    expect(formatPhoneNumber('(123) 456-7890')).toBe('(123) 456-7890');
  });
});
