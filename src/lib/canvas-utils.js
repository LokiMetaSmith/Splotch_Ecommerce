
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

    let majorMarkSpacing, minorMarkSpacing;
    let ticksPerMajor;
    let labelMultiplier;
    let labelSuffix = '';

    const physicalWidthInches = bounds.width / ppi;
    const physicalWidthMm = (bounds.width / ppi) * 25.4;

    // Do not draw ruler for very small images where it would become illegible
    if (isMetric && physicalWidthMm < 20) return;
    if (!isMetric && physicalWidthInches < 2) return;

    if (isMetric) {
        if (physicalWidthMm >= 1000) {
            // >= 1000mm: meters (major every 0.1m (100mm), minor every 0.01m (10mm))
            majorMarkSpacing = 100 * ppi / 25.4; // 0.1m
            minorMarkSpacing = majorMarkSpacing / 10;
            ticksPerMajor = 10;
            labelMultiplier = 0.1;
            labelSuffix = 'm';
        } else {
            // Default: mm (major every 10mm (1cm), minor every 1mm)
            majorMarkSpacing = 10 * ppi / 25.4; // 10mm
            minorMarkSpacing = majorMarkSpacing / 10;
            ticksPerMajor = 10;
            labelMultiplier = 10;
            labelSuffix = 'mm';
        }
    } else {
        if (physicalWidthInches >= 24) {
            // >= 24 inches: feet (major every 1 foot, minor every 1 inch)
            majorMarkSpacing = 12 * ppi; // 1 foot
            minorMarkSpacing = majorMarkSpacing / 12;
            ticksPerMajor = 12;
            labelMultiplier = 1;
            labelSuffix = 'ft';
        } else if (physicalWidthInches <= 3) {
            // <= 3 inches: (major every 0.5 inch, minor every 1/16 inch)
            majorMarkSpacing = ppi / 2; // 0.5 inch
            minorMarkSpacing = majorMarkSpacing / 8; // 1/16 inch
            ticksPerMajor = 8;
            labelMultiplier = 0.5;
            labelSuffix = 'in';
        } else {
            // Default: inches (major every 1 inch, minor every 1/8 inch)
            majorMarkSpacing = ppi; // 1 inch
            minorMarkSpacing = majorMarkSpacing / 8;
            ticksPerMajor = 8;
            labelMultiplier = 1;
            labelSuffix = 'in';
        }
    }

    const ppiScale = ppi / 96;
    const fontSize = Math.max(12, Math.round(12 * ppiScale));
    const tickScale = Math.max(1, ppiScale);
    const lineWidth = Math.max(1, Math.round(1 * ppiScale));
    const labelSpacingOffset = 2 * tickScale;

    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.font = `${fontSize}px Arial`;
    ctx.lineWidth = lineWidth;

    // Bolt Optimization: Batch drawing calls to reduce overhead
    // Top ruler
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.width; i++) {
        const x = bounds.left + offset.x + i * minorMarkSpacing;
        const y = bounds.top + offset.y; // Start exactly at the bounding box
        const isMajorMark = i % ticksPerMajor === 0;
        const markHeight = isMajorMark ? 15 * tickScale : 8 * tickScale;

        // Draw ticks going OUTWARDS (up) from the bounding box
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - markHeight);

        if (isMajorMark && i > 0) {
            const labelValue = (i / ticksPerMajor) * labelMultiplier;
            const label = `${Number.isInteger(labelValue) ? labelValue : labelValue.toFixed(1)}${labelSuffix}`;
            ctx.fillText(label, x + 3 * tickScale, y - markHeight - labelSpacingOffset);
        }
    }
    ctx.stroke();

    // Left ruler
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.height; i++) {
        const y = bounds.top + offset.y + i * minorMarkSpacing;
        const x = bounds.left + offset.x; // Start exactly at the bounding box
        const isMajorMark = i % ticksPerMajor === 0;
        const markWidth = isMajorMark ? 15 * tickScale : 8 * tickScale;

        // Draw ticks going OUTWARDS (left) from the bounding box
        ctx.moveTo(x, y);
        ctx.lineTo(x - markWidth, y);

        if (isMajorMark && i > 0) {
            const labelValue = (i / ticksPerMajor) * labelMultiplier;
            const label = `${Number.isInteger(labelValue) ? labelValue : labelValue.toFixed(1)}${labelSuffix}`;
            ctx.fillText(label, x - markWidth - (5 * tickScale) - (ctx.measureText(label).width), y + (fontSize / 3));
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
