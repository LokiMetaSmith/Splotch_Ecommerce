import { jest } from '@jest/globals';
import { fileURLToPath } from 'url';
import path from 'path';

describe('EncryptedJSONFile Read Errors', () => {
    let EncryptedJSONFile;
    let mockReadFile;

    beforeEach(async () => {
        jest.resetModules();

        // Mock implementation for fs.promises
        mockReadFile = jest.fn();

        const originalFs = await import('fs');

        jest.unstable_mockModule('fs', () => ({
            default: {
                ...originalFs.default,
                promises: {
                    ...originalFs.default.promises,
                    readFile: mockReadFile,
                },
            },
            promises: {
                ...originalFs.promises,
                readFile: mockReadFile,
            }
        }));

        const module = await import('../server/database/EncryptedJSONFile.js');
        EncryptedJSONFile = module.EncryptedJSONFile;

        await import('../server/encryption.js');
    });

    test('should return null if file does not exist (ENOENT)', async () => {
        const error = new Error('File not found');
        error.code = 'ENOENT';
        mockReadFile.mockRejectedValue(error);

        const adapter = new EncryptedJSONFile('test.json');
        const result = await adapter.read();

        expect(result).toBeNull();
        expect(mockReadFile).toHaveBeenCalledWith('test.json', 'utf-8');
    });

    test('should throw error for other file system errors', async () => {
        const error = new Error('Permission denied');
        error.code = 'EACCES';
        mockReadFile.mockRejectedValue(error);

        const adapter = new EncryptedJSONFile('test.json');

        await expect(adapter.read()).rejects.toThrow('Permission denied');
    });

    test('should return null if file content is empty or only whitespace', async () => {
        mockReadFile.mockResolvedValue('   \n  ');

        const adapter = new EncryptedJSONFile('test.json');
        const result = await adapter.read();

        expect(result).toBeNull();
    });

    test('should throw error if content is neither valid encrypted data nor plain JSON', async () => {
        mockReadFile.mockResolvedValue('invalid data');

        const adapter = new EncryptedJSONFile('test.json');

        await expect(adapter.read()).rejects.toThrow(/Failed to read database:/);
    });
});