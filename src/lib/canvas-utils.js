
/**
 * Determines the high-contrast theme (colors and drop shadows) based on the canvas background.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @returns {object} Theme with colors and drop shadow settings for rulers and dimension indicators.
 */
export function getCanvasTheme(ctx) {
    let bgColor = "white";
    if (ctx && ctx.canvas) {
        bgColor =
            ctx.canvas.style?.backgroundColor ||
            (typeof window !== "undefined" && ctx.canvas instanceof Element
                ? window.getComputedStyle(ctx.canvas).backgroundColor
                : "white");
    }

    let r = 255,
        g = 255,
        b = 255;
    if (bgColor) {
        const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            r = parseInt(match[1], 10);
            g = parseInt(match[2], 10);
            b = parseInt(match[3], 10);
        } else if (bgColor.startsWith("#")) {
            const hex = bgColor.replace("#", "");
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else if (hex.length >= 6) {
                r = parseInt(hex.substring(0, 2), 16);
                g = parseInt(hex.substring(2, 4), 16);
                b = parseInt(hex.substring(4, 6), 16);
            }
        }
    }

    // Perceived luminance (ITU-R BT.709)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const isDark = luminance < 0.5;

    if (isDark) {
        // Inverse/contrast colors for dark background (e.g. Dark mode #1f2937 or Magenta):
        // Bright white strokes and text with a prominent dark drop shadow underneath
        return {
            isDark: true,
            strokeColor: "rgba(255, 255, 255, 0.9)",
            textColor: "rgba(255, 255, 255, 0.95)",
            shadowColor: "rgba(0, 0, 0, 0.9)",
            boxStroke: "rgba(255, 255, 255, 0.45)",
        };
    } else {
        // Colors for light background:
        // Dark strokes and text with a crisp light drop shadow underneath
        return {
            isDark: false,
            strokeColor: "rgba(0, 0, 0, 0.7)",
            textColor: "rgba(0, 0, 0, 0.9)",
            shadowColor: "rgba(255, 255, 255, 0.95)",
            boxStroke: "rgba(128, 128, 128, 0.4)",
        };
    }
}

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

    const theme = getCanvasTheme(ctx);

    ctx.save();
    ctx.shadowColor = theme.shadowColor;
    ctx.shadowBlur = Math.round(3 * tickScale);
    ctx.shadowOffsetX = Math.round(1 * tickScale);
    ctx.shadowOffsetY = Math.round(1 * tickScale);
    ctx.strokeStyle = theme.strokeColor;
    ctx.fillStyle = theme.textColor;
    ctx.font = `${fontSize}px Arial`;
    ctx.lineWidth = lineWidth;

    // Top ruler ticks
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.width; i++) {
        const x = bounds.left + offset.x + i * minorMarkSpacing;
        const y = bounds.top + offset.y; // Start exactly at the bounding box
        const isMajorMark = i % ticksPerMajor === 0;
        const markHeight = isMajorMark ? 15 * tickScale : 8 * tickScale;

        // Draw ticks going OUTWARDS (up) from the bounding box
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - markHeight);
    }
    ctx.stroke();

    // Top ruler labels
    for (let i = 0; i * minorMarkSpacing <= bounds.width; i++) {
        const x = bounds.left + offset.x + i * minorMarkSpacing;
        const y = bounds.top + offset.y;
        const isMajorMark = i % ticksPerMajor === 0;
        const markHeight = isMajorMark ? 15 * tickScale : 8 * tickScale;
        if (isMajorMark && i > 0) {
            const labelValue = (i / ticksPerMajor) * labelMultiplier;
            const label = `${Number.isInteger(labelValue) ? labelValue : labelValue.toFixed(1)}${labelSuffix}`;
            ctx.fillText(label, x + 3 * tickScale, y - markHeight - labelSpacingOffset);
        }
    }

    // Left ruler ticks
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.height; i++) {
        const y = bounds.top + offset.y + i * minorMarkSpacing;
        const x = bounds.left + offset.x; // Start exactly at the bounding box
        const isMajorMark = i % ticksPerMajor === 0;
        const markWidth = isMajorMark ? 15 * tickScale : 8 * tickScale;

        // Draw ticks going OUTWARDS (left) from the bounding box
        ctx.moveTo(x, y);
        ctx.lineTo(x - markWidth, y);
    }
    ctx.stroke();

    // Left ruler labels
    for (let i = 0; i * minorMarkSpacing <= bounds.height; i++) {
        const y = bounds.top + offset.y + i * minorMarkSpacing;
        const x = bounds.left + offset.x;
        const isMajorMark = i % ticksPerMajor === 0;
        const markWidth = isMajorMark ? 15 * tickScale : 8 * tickScale;
        if (isMajorMark && i > 0) {
            const labelValue = (i / ticksPerMajor) * labelMultiplier;
            const label = `${Number.isInteger(labelValue) ? labelValue : labelValue.toFixed(1)}${labelSuffix}`;
            ctx.fillText(label, x - markWidth - (5 * tickScale) - (ctx.measureText(label).width), y + (fontSize / 3));
        }
    }

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
