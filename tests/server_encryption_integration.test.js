import { jest } from '@jest/globals';

describe('Server Encryption Integration', () => {
    let encrypt;
    let decrypt;

    beforeAll(async () => {
        // Set environment variables before importing the module
        process.env.ENCRYPT_CLIENT_JSON = 'true';
        process.env.JWT_SECRET = 'test-secret-32-chars-long-exactly!';

        // Dynamic import to pick up env vars
        const module = await import('../server/index.js');
        encrypt = module.encrypt;
        decrypt = module.decrypt;
    });

    test('encrypts data correctly', () => {
        const text = 'test data';
        const encrypted = encrypt(text);
        expect(encrypted).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/); // IV (16 bytes hex) : Ciphertext
        expect(encrypted).not.toContain(text);
    });

    test('decrypts data correctly', () => {
        const text = 'sensitive information';
        const encrypted = encrypt(text);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(text);
    });

    test('encryption is randomized (IV changes)', () => {
        const text = 'same text';
        const encrypted1 = encrypt(text);
        const encrypted2 = encrypt(text);
        expect(encrypted1).not.toBe(encrypted2);

        // Decryption should still work for both
        expect(decrypt(encrypted1)).toBe(text);
        expect(decrypt(encrypted2)).toBe(text);
    });
});
