
import { describe, it, expect, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDesignDimensions } from '../pricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Recursion DoS Prevention', () => {
    const tempFile = path.join(__dirname, 'temp_deep_nested.svg');

    afterAll(() => {
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    });

    it('should handle deeply nested SVGs without stack overflow', async () => {
        // Create a deeply nested SVG that would normally cause a stack overflow
        const depth = 20000;
        let svgContent = '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">';
        // Use a simple loop to build string to avoid stack overflow during string construction if we used recursion there too!
        // String concatenation is safe.
        const openTags = '<g>'.repeat(depth);
        const closeTags = '</g>'.repeat(depth);

        svgContent += openTags;
        svgContent += '<rect width="10" height="10" />';
        svgContent += closeTags;
        svgContent += '</svg>';

        fs.writeFileSync(tempFile, svgContent);

        // We expect this to NOT throw "Maximum call stack size exceeded"
        // It might throw "SVG complexity exceeds maximum limit" if we implement a limit.
        // Or it might succeed if we just switch to iterative without a low limit.

        try {
            await getDesignDimensions(tempFile);
        } catch (error) {
            // If we implement a limit, this is acceptable
            if (error.message === 'SVG complexity exceeds maximum limit.') {
                expect(true).toBe(true);
                return;
            }
            // If it's a stack overflow, we fail (but the process might crash before we get here)
            if (error.stack && error.stack.includes('Maximum call stack size exceeded')) {
                throw new Error('Stack Overflow detected!');
            }
            // Any other error is also a failure of the test's intent (unless it's file not found etc)
            throw error;
        }
    });
});
