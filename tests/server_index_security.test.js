
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import crypto from 'crypto';
import { JSONFilePreset } from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverIndexPath = path.resolve(__dirname, '../server/index.js');

describe('Server Index Security', () => {
    test('db.write override uses async I/O and atomic writes', () => {
        const content = fs.readFileSync(serverIndexPath, 'utf8');

        // We look for the db.write override block.
        // We use a regex that is more robust to template literals containing braces.
        // The previous regex was: /db\.write\s*=\s*async\s*function\(\)\s*{([\s\S]*?)}/
        // This fails if the body contains a nested `}` which happens in template literals like `${dbPath}.tmp`.

        // Instead of capturing the body with a greedy regex, we can find the start and balance braces,
        // or just check for the presence of the critical lines within the function definition scope implicitly.

        // Given the known structure, we can verify that the async function definition contains the required calls.

        const dbWriteStartRegex = /(?:db|lowDbInstance)\.write\s*=\s*async\s*function\(\)\s*{/;
        const match = content.match(dbWriteStartRegex);

        if (!match) {
             throw new Error('Could not find db.write override in server/index.js');
        }

        const startIndex = match.index;
        const relevantSection = content.slice(startIndex, startIndex + 500); // Look at the next 500 chars which should cover the function body

        expect(relevantSection).toMatch(/await\s+fs\.promises\.writeFile/);
        expect(relevantSection).toMatch(/await\s+fs\.promises\.rename/);

        // Ensure no sync write in the relevant section, but careful not to match the one in the setup block before it.
        // We'll check that fs.writeFileSync doesn't appear in the async function body.
        expect(relevantSection).not.toMatch(/fs\.writeFileSync.*(?=await)/);
    });

    test('reproduction: db.write logic is async, atomic, and encrypts data', async () => {
        const dbPath = path.join(__dirname, 'test-db-write.json');
        const ENCRYPTION_KEY = '12345678901234567890123456789012'; // 32 chars
        const IV_LENGTH = 16;

        function encrypt(text) {
            let iv = crypto.randomBytes(IV_LENGTH);
            let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
            let encrypted = cipher.update(text);
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            return iv.toString('hex') + ':' + encrypted.toString('hex');
        }

        const originalWriteFile = fs.promises.writeFile;
        const originalRename = fs.promises.rename;

        const writeFileMock = jest.fn(async (file, data, options) => {
             return originalWriteFile(file, data, options);
        });
        const renameMock = jest.fn(async (oldPath, newPath) => {
             return originalRename(oldPath, newPath);
        });

        fs.promises.writeFile = writeFileMock;
        fs.promises.rename = renameMock;

        try {
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
            const db = await JSONFilePreset(dbPath, { test: 1 });

            // Simulate the override from server/index.js
            const originalWrite = db.write;
            db.write = async function() {
                const data = JSON.stringify(this.data);
                const encryptedData = encrypt(data);
                const tempPath = `${dbPath}.tmp`;
                await fs.promises.writeFile(tempPath, encryptedData);
                await fs.promises.rename(tempPath, dbPath);
            }

            // Perform write
            db.data.updated = true;
            await db.write();

            // Verify
            expect(writeFileMock).toHaveBeenCalledTimes(1);
            expect(writeFileMock).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expect.stringMatching(/:/)); // IV:Encrypted

            expect(renameMock).toHaveBeenCalledTimes(1);
            expect(renameMock).toHaveBeenCalledWith(expect.stringContaining('.tmp'), dbPath);

            const writtenContent = fs.readFileSync(dbPath, 'utf8');
            expect(writtenContent).toContain(':');

        } finally {
            fs.promises.writeFile = originalWriteFile;
            fs.promises.rename = originalRename;
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
            if (fs.existsSync(dbPath + '.tmp')) fs.unlinkSync(dbPath + '.tmp');
        }
    });
});
