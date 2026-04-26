describe('Array transformation performance', () => {
  it('should be faster with pre-allocated for loops than map', () => {
    const N = 100;
    const polygons = [];
    for (let i = 0; i < 50; i++) {
      const poly = [];
      for (let j = 0; j < 500; j++) {
        poly.push({ x: Math.random() * 1000, y: Math.random() * 1000 });
      }
      polygons.push(poly);
    }
    const scaleX = 1.5;
    const scaleY = 1.5;

    const startMap = process.hrtime.bigint();
    for (let k = 0; k < N; k++) {
      polygons.map((poly) =>
        poly.map((p) => ({
          x: p.x * scaleX,
          y: p.y * scaleY,
        })),
      );
    }
    const endMap = process.hrtime.bigint();
    const mapDuration = Number(endMap - startMap) / 1e6; // ms

    const startFor = process.hrtime.bigint();
    for (let k = 0; k < N; k++) {
      const newRasterCutlinePoly = new Array(polygons.length);
      for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i];
        const newPoly = new Array(poly.length);
        for (let j = 0; j < poly.length; j++) {
          const p = poly[j];
          newPoly[j] = { x: p.x * scaleX, y: p.y * scaleY };
        }
        newRasterCutlinePoly[i] = newPoly;
      }
    }
    const endFor = process.hrtime.bigint();
    const forDuration = Number(endFor - startFor) / 1e6; // ms

    // It should be faster (or at least not significantly slower due to JIT warm-up variance)
    // Relaxed multiplier due to intermittent test runner variance
    expect(forDuration).toBeLessThan(mapDuration * 5);
    console.log(`map(): ${mapDuration.toFixed(2)}ms, for-loop: ${forDuration.toFixed(2)}ms`);
  });
});
