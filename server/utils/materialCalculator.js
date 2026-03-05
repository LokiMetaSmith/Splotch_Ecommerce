import { Jimp } from 'jimp';
import fs from 'fs/promises';
import sizeOf from 'image-size';

export async function calculateMaterialUsage(filePath, ppi = 300) {
    try {
        const buffer = await fs.readFile(filePath);

        // Security Check: Verify image dimensions before expensive processing
        // Limit to ~50 Megapixels (e.g., 8000x6000) to prevent DoS
        try {
            const dimensions = sizeOf(buffer);
            if (dimensions && dimensions.width && dimensions.height) {
                const totalPixels = dimensions.width * dimensions.height;
                if (totalPixels > 50_000_000) {
                    throw new Error('Image too large for processing (exceeds 50MP limit)');
                }
            }
        } catch (e) {
            // Re-throw our security error, ignore image-size parsing errors (let Jimp handle/fail them)
            if (e.message.includes('Image too large')) {
                throw e;
            }
        }

        const image = await Jimp.read(buffer);

        const widthPx = image.width;
        const heightPx = image.height;

        const widthIn = widthPx / ppi;
        const heightIn = heightPx / ppi;
        const areaIn2 = widthIn * heightIn;

        let totalPixels = widthPx * heightPx;
        let coloredPixels = 0;

        // Resize for performance if large (e.g. > 1MP)
        if (totalPixels > 1000000) {
             image.scaleToFit({ w: 1000, h: 1000 });
             totalPixels = image.width * image.height;
             // Update width/height for pixel counting, but keep original dimensions for area calculation?
             // Yes, areaIn2 is based on original PPI.
        }

        // Bolt Optimization: Replace Jimp's image.scan() which calls a callback function per pixel.
        // Directly iterating over the underlying Buffer (Uint8Array) eliminates function call overhead
        // and dramatically speeds up ink coverage calculation for large images.
        const data = image.bitmap.data;
        const len = data.length;

        for (let idx = 0; idx < len; idx += 4) {
            const a = data[idx + 3];

            // If transparent (alpha < 10), skip
            if (a < 10) continue;

            const r = data[idx + 0];
            const g = data[idx + 1];
            const b = data[idx + 2];

            // If almost white (RGB > 240), treat as white (no ink)
            if (r > 240 && g > 240 && b > 240) continue;

            coloredPixels++;
        }

        // Avoid division by zero
        if (totalPixels === 0) totalPixels = 1;

        const inkCoveragePercent = (coloredPixels / totalPixels) * 100;

        return {
            widthIn,
            heightIn,
            areaIn2,
            inkCoveragePercent
        };
    } catch (error) {
        throw new Error(`Failed to calculate material usage: ${error.message}`);
    }
}
