import fs from 'fs';
import path from 'path';
import { SVGParser } from './src/lib/svgparser.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'server/uploads');
const parser = new SVGParser();

fs.readdir(uploadsDir, (err, files) => {
    if (err) {
        console.error('Error reading uploads directory:', err);
        return;
    }

    files.forEach(file => {
        if (path.extname(file).toLowerCase() === '.svg') {
            const filePath = path.join(uploadsDir, file);
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    console.error(`Error reading file ${file}:`, err);
                    return;
                }
                try {
                    parser.load(data);
                    console.log(`${file} is a valid SVG.`);
                } catch (e) {
                    console.error(`${file} is not a valid SVG:`, e.message);
                }
            });
        }
    });
});
