
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('server/index.js db.write override', () => {
    it('should use async file I/O (fs.promises.writeFile) instead of synchronous write', () => {
        const indexPath = path.join(__dirname, '../server/index.js');
        const content = fs.readFileSync(indexPath, 'utf8');

        // Extract the db.write override block.
        // We use a regex that looks for the function definition and ensures it includes the async write call.
        // The previous regex failed because it stopped at the first '}' found in the template string `${dbPath}`.
        const overrideBlockRegex = /db\.write\s*=\s*async\s*function\(\)\s*\{([\s\S]*?)\n\s* \}/;

        // Alternative: Just check if the file contains the pattern where db.write is assigned an async function that uses fs.promises.writeFile
        const hasAsyncWriteOverride = /db\.write\s*=\s*async\s*function\(\)\s*\{[\s\S]*?await\s+fs\.promises\.writeFile/.test(content);

        expect(hasAsyncWriteOverride).toBe(true);

        // We also want to ensure that inside this override, we are NOT using synchronous write.
        // To do this robustly with regex is hard.
        // Instead, let's verify that `fs.writeFileSync` is NOT present in the lines immediately following `db.write = async function() {`

        const lines = content.split('\n');
        let insideOverride = false;
        let braceCount = 0;
        let overrideBody = '';

        for (const line of lines) {
            if (line.includes('db.write = async function() {')) {
                insideOverride = true;
                braceCount = 1; // Assuming the opening brace is on this line
                continue;
            }

            if (insideOverride) {
                overrideBody += line + '\n';
                // Simple brace counting (not perfect but likely sufficient for this file)
                braceCount += (line.match(/\{/g) || []).length;
                braceCount -= (line.match(/\}/g) || []).length;

                if (braceCount === 0) {
                    insideOverride = false;
                    break;
                }
            }
        }

        expect(overrideBody).toContain('await fs.promises.writeFile');
        expect(overrideBody).not.toContain('fs.writeFileSync');
    });
});
