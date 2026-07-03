
/**
 * Draws a ruler on the canvas around the provided bounds.
 * Optimized to batch line drawing calls for performance.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @param {object} bounds - The bounding box {left, top, width, height}.
 * @param {object} offset - The offset {x, y} to apply.
 * @param {number} ppi - Pixels per inch resolution.
 * @param {boolean} isMetric - Whether to use metric units (mm) or imperial (in).
 */
export function drawRuler(ctx, bounds, offset = { x: 0, y: 0 }, ppi, isMetric) {
    if (!ctx || !bounds || !ppi) return;

    const majorMarkSpacing = isMetric ? 10 * ppi / 25.4 : ppi; // 10mm or 1in
    const minorMarkSpacing = isMetric ? majorMarkSpacing / 10 : majorMarkSpacing / 8; // 1mm or 1/8in

    // Calculate a scale factor so ticks and text are visible on large images
    const scale = Math.max(bounds.width, bounds.height) / 500;
    const fontSize = Math.max(12, Math.round(12 * scale));
    const tickScale = Math.max(1, scale);

    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.font = `${fontSize}px Arial`;
    ctx.lineWidth = Math.max(1, 1.5 * scale);

    // Bolt Optimization: Batch drawing calls to reduce overhead
    // Top ruler
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.width; i++) {
        const x = bounds.left + offset.x + i * minorMarkSpacing;
        const y = bounds.top + offset.y; // Start exactly at the bounding box
        const isMajorMark = i % (isMetric ? 10 : 8) === 0;
        const markHeight = isMajorMark ? 15 * tickScale : 8 * tickScale;

        // Draw ticks going OUTWARDS (up) from the bounding box
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - markHeight);

        if (isMajorMark && i > 0) {
            const label = isMetric ? (i / 10) : (i / 8);
            ctx.fillText(label, x + (3 * scale), y - markHeight - (2 * scale));
        }
    }
    ctx.stroke();

    // Left ruler
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.height; i++) {
        const y = bounds.top + offset.y + i * minorMarkSpacing;
        const x = bounds.left + offset.x; // Start exactly at the bounding box
        const isMajorMark = i % (isMetric ? 10 : 8) === 0;
        const markWidth = isMajorMark ? 15 * tickScale : 8 * tickScale;

        // Draw ticks going OUTWARDS (left) from the bounding box
        ctx.moveTo(x, y);
        ctx.lineTo(x - markWidth, y);

        if (isMajorMark && i > 0) {
            const label = isMetric ? (i / 10) : (i / 8);
            ctx.fillText(label, x - markWidth - (5 * scale) - (ctx.measureText(label).width), y + (fontSize / 3));
        }
    }
    ctx.stroke();

    ctx.restore();
}

/**
 * Draws an image onto the canvas with hardware-accelerated filters.
 * Replaces expensive pixel-manipulation loops.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @param {HTMLImageElement|HTMLCanvasElement} image - The source image.
 * @param {number} width - The width to draw.
 * @param {number} height - The height to draw.
 * @param {object} options - Filter options { grayscale: boolean, sepia: boolean }.
 * @param {Object} offset - Translation offset.
 */
export function drawImageWithFilters(ctx, image, width, height, { grayscale, sepia } = {}, offset = { x: 0, y: 0 }) {
    if (!ctx || !image) return;

    ctx.clearRect(0, 0, width, height);

    ctx.save();

    // Apply translation before drawing
    ctx.translate(offset.x, offset.y);

    if (grayscale) {
        ctx.filter = 'grayscale(100%)';
    } else if (sepia) {
        ctx.filter = 'sepia(100%)';
    } else {
        ctx.filter = 'none';
    }

    ctx.drawImage(image, 0, 0, width, height);
    ctx.restore();
}
