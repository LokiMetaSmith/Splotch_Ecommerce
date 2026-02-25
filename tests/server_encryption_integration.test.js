import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Server Encryption Integration', () => {
    let encrypt;
    let decrypt;
    let EncryptedJSONFile;

    beforeAll(async () => {
        // Set environment variables before importing the module
        process.env.ENCRYPT_CLIENT_JSON = 'true';
        process.env.JWT_SECRET = 'test-secret-32-chars-long-exactly!';

        // Dynamic import to pick up env vars
        // We import encryption.js directly to test core logic
        const encryptionModule = await import('../server/encryption.js');
        encrypt = encryptionModule.encrypt;
        decrypt = encryptionModule.decrypt;

        // We import EncryptedJSONFile to test the adapter
        const adapterModule = await import('../server/database/EncryptedJSONFile.js');
        EncryptedJSONFile = adapterModule.EncryptedJSONFile;
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

    test('EncryptedJSONFile writes encrypted data to disk', async () => {
        const testFile = path.join(__dirname, 'test_encrypted_db.json');
        const adapter = new EncryptedJSONFile(testFile);
        const data = { secret: 'super sensitive' };

        await adapter.write(data);

        // Read file directly from disk
        const fileContent = fs.readFileSync(testFile, 'utf-8');

        // Should look like IV:Ciphertext
        expect(fileContent).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);

        // Should not contain the secret in plaintext
        expect(fileContent).not.toContain('super sensitive');

        // Should be readable by the adapter
        const readData = await adapter.read();
        expect(readData).toEqual(data);

        // Cleanup
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
    });

    test('EncryptedJSONFile reads plaintext JSON (migration)', async () => {
        const testFile = path.join(__dirname, 'test_migration_db.json');
        const data = { legacy: 'data' };

        // Write plaintext JSON
        fs.writeFileSync(testFile, JSON.stringify(data));

        const adapter = new EncryptedJSONFile(testFile);

        // Should be readable
        const readData = await adapter.read();
        expect(readData).toEqual(data);

        // Cleanup
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
    });
});
