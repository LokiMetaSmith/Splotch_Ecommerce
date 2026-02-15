/**
 * Formats a raw phone number string into (XXX) XXX-XXXX format.
 * @param {string} value - The raw input value.
 * @returns {string} - The formatted phone number.
 */
export function formatPhoneNumber(value) {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, '');
  const phoneNumberLength = phoneNumber.length;

  if (phoneNumberLength < 4) return phoneNumber;
  if (phoneNumberLength < 7) {
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
  }
  return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
}

/**
 * Sets up phone number formatting for the #phone input field.
 */
export function setupPhoneFormatting() {
  const phoneInput = document.getElementById('phone');
  if (!phoneInput) return;

  phoneInput.addEventListener('input', (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    if (e.target.value !== formatted) {
      e.target.value = formatted;
    }
  });
}

// Initialize on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    setupPhoneFormatting();
  });
}
