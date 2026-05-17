function traceContours(imageData, sensitivity = 50, scaleFactor = 1) {
  return new Promise((resolve) => {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Use a fixed sensitivity mapped to a sensible threshold
    const alphaThreshold = Math.max(1, Math.min(254, Math.floor(255 - (sensitivity / 100) * 255)));

    const visited = new Uint8Array(width * height);
    const contours = [];

    // Moore neighborhood directions (clockwise starting from top)
    const dirs = [
      { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
      { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 }
    ];

    function isSolid(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const idx = (y * width + x) * 4;
      return data[idx + 3] >= alphaThreshold;
    }

    function traceContour(startX, startY) {
      const contour = [];
      let currentX = startX;
      let currentY = startY;
      let dir = 0; // Start looking "up"

      let iters = 0;
      const MAX_ITERS = 10000;

      while (iters < MAX_ITERS) {
        contour.push({ x: currentX / scaleFactor, y: currentY / scaleFactor });

        let found = false;
        let nextDir = (dir + 5) % 8; // Back up and check counter-clockwise

        for (let i = 0; i < 8; i++) {
          const checkDir = (nextDir + i) % 8;
          const nextX = currentX + dirs[checkDir].x;
          const nextY = currentY + dirs[checkDir].y;

          if (isSolid(nextX, nextY)) {
            currentX = nextX;
            currentY = nextY;
            dir = checkDir;
            found = true;
            break;
          }
        }

        if (!found || (currentX === startX && currentY === startY)) {
            break;
        }
        iters++;
      }
      return contour;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!visited[idx] && isSolid(x, y)) {
          // Check if it's a boundary pixel (left is transparent or edge)
          if (x === 0 || !isSolid(x - 1, y)) {
             const contour = traceContour(x, y);

             // Mark visited
             for (const p of contour) {
                 const px = Math.floor(p.x * scaleFactor);
                 const py = Math.floor(p.y * scaleFactor);
                 if (px >= 0 && px < width && py >= 0 && py < height) {
                     visited[py * width + px] = 1;
                 }
             }

             if (contour.length > 10) {
                 contours.push(contour);
             }
          }
        }
      }
    }

    resolve(contours);
  });
}

onmessage = async function(e) {
  try {
    const { imageData, cutlineSensitivity, scaleFactor } = e.data;
    const contours = await traceContours(imageData, cutlineSensitivity, scaleFactor);
    postMessage({ success: true, contours });
  } catch (error) {
    postMessage({ success: false, error: error.message });
  }
};
