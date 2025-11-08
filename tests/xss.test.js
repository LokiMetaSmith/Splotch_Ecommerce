
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

const { window } = new JSDOM('');
const purify = DOMPurify(window);

// This is the function we are testing, extracted for clarity.
const sanitizeContactObject = (contact) => {
    if (!contact) return null;
    const sanitized = {};
    for (const key in contact) {
        if (Object.prototype.hasOwnProperty.call(contact, key)) {
            const value = contact[key];
            if (typeof value === 'string') {
                sanitized[key] = purify.sanitize(value);
            } else if (Array.isArray(value)) {
                sanitized[key] = value.map(item => (typeof item === 'string' ? purify.sanitize(item) : item));
            } else {
                sanitized[key] = value;
            }
        }
    }
    return sanitized;
};

describe('XSS Sanitization', () => {
    it('should remove script tags from all string properties of a contact object', () => {
        const maliciousContact = {
            givenName: '<script>alert("XSS")</script>John',
            familyName: 'Doe<img src=x onerror=alert("img-xss")>',
            email: 'john.doe@example.com',
            addressLines: [
                '123 Main St',
                '<style>body{display:none}</style>'
            ],
            city: 'Anytown',
            postalCode: '12345',
            countryCode: 'US',
            shouldBeUnchanged: 123
        };

        const sanitizedContact = sanitizeContactObject(maliciousContact);

        expect(sanitizedContact.givenName).toBe('John');
        expect(sanitizedContact.familyName).toBe('Doe<img src="x">');
        expect(sanitizedContact.email).toBe('john.doe@example.com');
        expect(sanitizedContact.addressLines[0]).toBe('123 Main St');
        expect(sanitizedContact.addressLines[1]).toBe(''); // style tags are removed
        expect(sanitizedContact.city).toBe('Anytown');
        expect(sanitizedContact.postalCode).toBe('12345');
        expect(sanitizedContact.countryCode).toBe('US');
        expect(sanitizedContact.shouldBeUnchanged).toBe(123);
    });

    it('should handle null or undefined contact objects gracefully', () => {
        expect(sanitizeContactObject(null)).toBeNull();
        expect(sanitizeContactObject(undefined)).toBeNull();
    });

    it('should handle objects with non-string, non-array properties', () => {
        const mixedContact = {
            givenName: 'Jane',
            age: 30,
            isCustomer: true,
            metadata: { a: 1 }
        };
        const sanitizedContact = sanitizeContactObject(mixedContact);
        expect(sanitizedContact.givenName).toBe('Jane');
        expect(sanitizedContact.age).toBe(30);
        expect(sanitizedContact.isCustomer).toBe(true);
        expect(sanitizedContact.metadata).toEqual({ a: 1 });
    });
});
