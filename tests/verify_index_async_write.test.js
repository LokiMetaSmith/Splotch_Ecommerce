
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('server/index.js db.write override', () => {
    it('should use async file I/O (fs.promises.writeFile) instead of synchronous write', () => {
        const indexPath = path.join(__dirname, '../server/index.js');
        const content = fs.readFileSync(indexPath, 'utf8');

        // Extract the db.write override block
        // We look for db.write = async function() ...
        const match = content.match(/db\.write\s*=\s*async\s*function\(\)\s*\{([\s\S]*?)\}/);

        expect(match).not.toBeNull();
        const body = match[1];

        // Check that it uses await fs.promises.writeFile
        expect(body).toContain('await fs.promises.writeFile');

        // Check that it does NOT use fs.writeFileSync
        expect(body).not.toContain('fs.writeFileSync');
    });
});
