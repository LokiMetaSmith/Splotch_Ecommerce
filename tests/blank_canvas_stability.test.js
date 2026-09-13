import { jest } from '@jest/globals';

describe('Blank Canvas Stability', () => {
  it('should maintain stable default dimensions without expanding on repeated redraws when content is empty', () => {
    const DEFAULT_CANVAS_WIDTH = 500;
    const DEFAULT_CANVAS_HEIGHT = 400;
    let baseCanvasWidth = DEFAULT_CANVAS_WIDTH;
    let baseCanvasHeight = DEFAULT_CANVAS_HEIGHT;

    // Simulate doRedrawAll calculation on blank canvas
    function computeBlankCanvasBounds(stickers = []) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasContent = false;

      stickers.forEach((layer) => {
        if (layer.currentCutline && layer.currentCutline.length > 0 && layer.visible !== false) {
          hasContent = true;
        } else if ((layer.originalImage || layer.image) && layer.visible !== false) {
          hasContent = true;
        }
      });

      if (!hasContent) {
        minX = 0;
        minY = 0;
        maxX = DEFAULT_CANVAS_WIDTH;
        maxY = DEFAULT_CANVAS_HEIGHT;
        baseCanvasWidth = DEFAULT_CANVAS_WIDTH;
        baseCanvasHeight = DEFAULT_CANVAS_HEIGHT;
      }

      const currentBounds = {
        left: minX,
        top: minY,
        right: maxX,
        bottom: maxY,
        width: maxX - minX,
        height: maxY - minY,
      };

      const ppi = 300;
      const ppiScale = ppi / 96;
      const scale = Math.max(currentBounds.width, currentBounds.height) / 500;
      const padding = Math.max(Math.round(60 * ppiScale), Math.round(40 * scale));

      const logicalWidth = currentBounds.width + padding * 2;
      const logicalHeight = currentBounds.height + padding * 2;

      return { currentBounds, logicalWidth, logicalHeight };
    }

    // Initial calculation
    const res1 = computeBlankCanvasBounds([]);
    expect(res1.currentBounds.width).toBe(500);
    expect(res1.currentBounds.height).toBe(400);
    expect(baseCanvasWidth).toBe(500);
    expect(baseCanvasHeight).toBe(400);

    // Repeated redraws (simulating mousemove / scroll events)
    for (let i = 0; i < 50; i++) {
      const res = computeBlankCanvasBounds([]);
      expect(res.currentBounds.width).toBe(500);
      expect(res.currentBounds.height).toBe(400);
      expect(res.logicalWidth).toBe(res1.logicalWidth);
      expect(res.logicalHeight).toBe(res1.logicalHeight);
      expect(baseCanvasWidth).toBe(500);
      expect(baseCanvasHeight).toBe(400);
    }
  });
});
