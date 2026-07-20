function traceContours(imageData, sensitivity = 50, scaleFactor = 1) {
  return new Promise((resolve) => {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Use a fixed sensitivity mapped to a sensible threshold
    const alphaThreshold = Math.max(1, Math.min(254, Math.floor(255 - (sensitivity / 100) * 255)));

    const u32 = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x12345678]).buffer)[0] === 0x78;

    // Detect solid background from corners to act as a "Magic Wand" for opaque images
    let bgColor = null;
    const getRGB = (pixel) => {
      if (IS_LITTLE_ENDIAN) {
        return { r: pixel & 0xFF, g: (pixel >>> 8) & 0xFF, b: (pixel >>> 16) & 0xFF, a: (pixel >>> 24) };
      } else {
        return { r: (pixel >>> 24) & 0xFF, g: (pixel >>> 16) & 0xFF, b: (pixel >>> 8) & 0xFF, a: pixel & 0xFF };
      }
    };
    
    const cornerIndices = [0, width - 1, (height - 1) * width, (height - 1) * width + width - 1];
    const corners = cornerIndices.map(idx => getRGB(u32[idx]));
    const c0 = corners[0];
    
    // Only detect solid backgrounds if the corners are opaque and roughly the same color
    if (c0.a > 250) {
      let allMatch = true;
      for (let i = 1; i < 4; i++) {
        const c = corners[i];
        if (c.a < 250 || Math.abs(c0.r - c.r) > 15 || Math.abs(c0.g - c.g) > 15 || Math.abs(c0.b - c.b) > 15) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        bgColor = c0;
      }
    }

    const visited = new Uint8Array(width * height);
    const contours = [];

    // Moore neighborhood directions (clockwise starting from top)
    const MOORE_X = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);
    const MOORE_Y = new Int8Array([-1, -1, 0, 1, 1, 1, 0, -1]);

    let isSolid;
    let checkPixel;
    
    // Tolerance for background removal
    const isBgColor = (rgb) => {
      if (!bgColor) return false;
      return Math.abs(bgColor.r - rgb.r) <= 25 && Math.abs(bgColor.g - rgb.g) <= 25 && Math.abs(bgColor.b - rgb.b) <= 25;
    };

    if (IS_LITTLE_ENDIAN) {
      isSolid = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const pixel = u32[y * width + x];
        if ((pixel >>> 24) < alphaThreshold) return false;
        if (bgColor && isBgColor({ r: pixel & 0xFF, g: (pixel >>> 8) & 0xFF, b: (pixel >>> 16) & 0xFF })) return false;
        return true;
      };
      checkPixel = (pixel) => {
        if ((pixel >>> 24) < alphaThreshold) return false;
        if (bgColor && isBgColor({ r: pixel & 0xFF, g: (pixel >>> 8) & 0xFF, b: (pixel >>> 16) & 0xFF })) return false;
        return true;
      };
    } else {
      isSolid = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const pixel = u32[y * width + x];
        if ((pixel & 0xff) < alphaThreshold) return false;
        if (bgColor && isBgColor({ r: (pixel >>> 24) & 0xFF, g: (pixel >>> 16) & 0xFF, b: (pixel >>> 8) & 0xFF })) return false;
        return true;
      };
      checkPixel = (pixel) => {
        if ((pixel & 0xff) < alphaThreshold) return false;
        if (bgColor && isBgColor({ r: (pixel >>> 24) & 0xFF, g: (pixel >>> 16) & 0xFF, b: (pixel >>> 8) & 0xFF })) return false;
        return true;
      };
    }

    function traceContour(startX, startY) {
      const contour = [];
      let cx = startX;
      let cy = startY;
      const startPos = { x: startX, y: startY };
      let lastDirection = 6; // Start checking from 6 (West)
      let foundNext = false;

      do {
        contour.push({ x: cx / scaleFactor, y: cy / scaleFactor });
        visited[cy * width + cx] = 1;

        let checkDirection = (lastDirection + 5) & 7;
        foundNext = false;

        for (let i = 0; i < 8; i++) {
          const nx = cx + MOORE_X[checkDirection];
          const ny = cy + MOORE_Y[checkDirection];

          if (isSolid(nx, ny)) {
            cx = nx;
            cy = ny;
            lastDirection = checkDirection;
            foundNext = true;
            break;
          }
          checkDirection = (checkDirection + 1) & 7;
        }

        if (!foundNext) break;
      } while (cx !== startPos.x || cy !== startPos.y);

      return contour;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!visited[idx] && checkPixel(u32[idx])) {
          // Check if it's a boundary pixel (left is transparent or edge)
          if (x === 0 || !checkPixel(u32[idx - 1])) {
             const contour = traceContour(x, y);

             // Mark visited inside the contour area (simplified approximation for safety)
             // The trace itself marks the boundary in the do-while loop above

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

self.addEventListener('message', async function(e) {
  try {
    const { imageData, cutlineSensitivity, scaleFactor } = e.data;
    const contours = await traceContours(imageData, cutlineSensitivity, scaleFactor);
    postMessage({ success: true, contours });
  } catch (error) {
    self.postMessage({ success: false, error: error.message });
  }
});
