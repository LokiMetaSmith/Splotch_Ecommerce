
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

    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.font = "10px Arial";
    ctx.lineWidth = 1;

    // Bolt Optimization: Batch drawing calls to reduce overhead
    // Top ruler
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.width; i++) {
        const x = offset.x + i * minorMarkSpacing;
        const y = offset.y - 10;
        const isMajorMark = i % (isMetric ? 10 : 8) === 0;
        const markHeight = isMajorMark ? 10 : 5;

        ctx.moveTo(x, y);
        ctx.lineTo(x, y + markHeight);

        if (isMajorMark && i > 0) {
            const label = isMetric ? (i / 10) : (i / 8);
            ctx.fillText(label, x - 3, y - 2);
        }
    }
    ctx.stroke();

    // Left ruler
    ctx.beginPath();
    for (let i = 0; i * minorMarkSpacing <= bounds.height; i++) {
        const y = offset.y + i * minorMarkSpacing;
        const x = offset.x - 10;
        const isMajorMark = i % (isMetric ? 10 : 8) === 0;
        const markWidth = isMajorMark ? 10 : 5;

        ctx.moveTo(x, y);
        ctx.lineTo(x + markWidth, y);

        if (isMajorMark && i > 0) {
            const label = isMetric ? (i / 10) : (i / 8);
            ctx.fillText(label, x - 12, y + 3);
        }
    }
    ctx.stroke();

    ctx.restore();
}
