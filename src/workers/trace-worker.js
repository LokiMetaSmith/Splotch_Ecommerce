function traceContours(imageData, sensitivity = 50, scaleFactor = 1) {
  return new Promise((resolve) => {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Use a fixed sensitivity mapped to a sensible threshold
    const alphaThreshold = Math.max(1, Math.min(254, Math.floor(255 - (sensitivity / 100) * 255)));

    const u32 = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x12345678]).buffer)[0] === 0x78;

    const visited = new Uint8Array(width * height);
    const contours = [];

    // Moore neighborhood directions (clockwise starting from top)
    const MOORE_X = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);
    const MOORE_Y = new Int8Array([-1, -1, 0, 1, 1, 1, 0, -1]);

    let isSolid;
    let checkPixel;
    if (IS_LITTLE_ENDIAN) {
      isSolid = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        return (u32[y * width + x] >>> 24) >= alphaThreshold;
      };
      checkPixel = (pixel) => (pixel >>> 24) >= alphaThreshold;
    } else {
      isSolid = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        return (u32[y * width + x] & 0xff) >= alphaThreshold;
      };
      checkPixel = (pixel) => (pixel & 0xff) >= alphaThreshold;
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

onmessage = async function(e) {
  try {
    const { imageData, cutlineSensitivity, scaleFactor } = e.data;
    const contours = await traceContours(imageData, cutlineSensitivity, scaleFactor);
    postMessage({ success: true, contours });
  } catch (error) {
    postMessage({ success: false, error: error.message });
  }
};
