import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// We need to mock fs.promises BEFORE importing the module under test
// However, since we are using ES modules, we can't easily hoist mocks above imports if we import the module directly.
// But EncryptedJSONFile uses `import fs from 'fs'`, so we can mock it using `jest.unstable_mockModule`.

describe('EncryptedJSONFile Atomic Writes', () => {
    let EncryptedJSONFile;
    let mockWriteFile;
    let mockRename;

    beforeEach(async () => {
        jest.resetModules();

        // Mock implementation for fs.promises
        mockWriteFile = jest.fn().mockResolvedValue(undefined);
        mockRename = jest.fn().mockResolvedValue(undefined);

        // We also need a real implementation for readFile if we want to test read, but here we focus on write.
        const originalFs = await import('fs');

        // Mock the 'fs' module
        // Note: In ESM, we mock the default export and named exports if necessary.
        jest.unstable_mockModule('fs', () => ({
            default: {
                ...originalFs.default,
                promises: {
                    ...originalFs.default.promises,
                    writeFile: mockWriteFile,
                    rename: mockRename,
                },
            },
            promises: {
                ...originalFs.promises,
                writeFile: mockWriteFile,
                rename: mockRename,
            }
        }));

        // Dynamic import to apply the mock
        const module = await import('../server/database/EncryptedJSONFile.js');
        EncryptedJSONFile = module.EncryptedJSONFile;

        // Also import encryption.js to ensure it works (it's a dependency)
        await import('../server/encryption.js');
    });

    test('write() should write to a temp file first and then rename it', async () => {
        const filename = 'test-db.json';
        const adapter = new EncryptedJSONFile(filename);
        const data = { key: 'value' };

        await adapter.write(data);

        // Verify writeFile was called with .tmp extension
        expect(mockWriteFile).toHaveBeenCalledTimes(1);
        const tempFile = `${filename}.tmp`;
        expect(mockWriteFile).toHaveBeenCalledWith(tempFile, expect.any(String));

        // Verify rename was called to move temp file to original filename
        expect(mockRename).toHaveBeenCalledTimes(1);
        expect(mockRename).toHaveBeenCalledWith(tempFile, filename);
    });
});
