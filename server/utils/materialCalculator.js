import { Jimp } from 'jimp';
import fs from 'fs/promises';

export async function calculateMaterialUsage(filePath, ppi = 300) {
    try {
        const buffer = await fs.readFile(filePath);
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

        image.scan(0, 0, image.width, image.height, (x, y, idx) => {
            const r = image.bitmap.data[idx + 0];
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2];
            const a = image.bitmap.data[idx + 3];

            // If transparent (alpha < 10), skip
            if (a < 10) return;

            // If almost white (RGB > 240), treat as white (no ink)
            if (r > 240 && g > 240 && b > 240) return;

            coloredPixels++;
        });

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
