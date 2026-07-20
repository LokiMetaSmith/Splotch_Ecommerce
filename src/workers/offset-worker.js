import * as ClipperLib from 'clipper-lib';

function smoothPolygon(polygon, iterations = 1) {
    if (polygon.length < 3) return polygon;
    let smoothed = [...polygon];

    for (let iter = 0; iter < iterations; iter++) {
        const nextSmoothed = [];
        for (let i = 0; i < smoothed.length; i++) {
            const p1 = smoothed[i];
            const p2 = smoothed[(i + 1) % smoothed.length];

            // Chaikin's algorithm: create 2 new points at 1/4 and 3/4 along the segment
            nextSmoothed.push({
                x: 0.75 * p1.x + 0.25 * p2.x,
                y: 0.75 * p1.y + 0.25 * p2.y
            });
            nextSmoothed.push({
                x: 0.25 * p1.x + 0.75 * p2.x,
                y: 0.25 * p1.y + 0.75 * p2.y
            });
        }
        smoothed = nextSmoothed;
    }
    return smoothed;
}

self.addEventListener('message', function(e) {
    try {
        const { messageId, polygons, offsetAmount, lassoRadius } = e.data;

        const scale = 100;
        const scaledPolygons = [];

        for (let i = 0; i < polygons.length; i++) {
            const path = new Array(polygons[i].length);
            for (let j = 0; j < polygons[i].length; j++) {
                path[j] = {
                    X: Math.round(polygons[i][j].x * scale),
                    Y: Math.round(polygons[i][j].y * scale)
                };
            }
            scaledPolygons.push(path);
        }

        const co = new ClipperLib.ClipperOffset();
        const offsetPolygons = new ClipperLib.Paths();
        const isNegativeOffset = offsetAmount < 0;

        // Apply a small positive offset for lasso logic if needed
        let initialPolygons = scaledPolygons;
        if (lassoRadius && lassoRadius > 0) {
            const tempCo = new ClipperLib.ClipperOffset();
            const tempPaths = new ClipperLib.Paths();
            tempCo.AddPaths(scaledPolygons, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
            const r = Math.max(1, Math.round(lassoRadius * scale));
            tempCo.Execute(tempPaths, r);

            const tempCo2 = new ClipperLib.ClipperOffset();
            const tempPaths2 = new ClipperLib.Paths();
            tempCo2.AddPaths(tempPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
            tempCo2.Execute(tempPaths2, -r);

            initialPolygons = tempPaths2;
        }

        if (isNegativeOffset) {
            co.MiterLimit = 10;
            co.ArcTolerance = 0.25;
            co.AddPaths(initialPolygons, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
        } else {
            co.AddPaths(initialPolygons, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        }

        co.Execute(offsetPolygons, Math.round(offsetAmount * scale));

        const finalCutline = [];
        for (let i = 0; i < offsetPolygons.length; i++) {
            const path = new Array(offsetPolygons[i].length);
            for (let j = 0; j < offsetPolygons[i].length; j++) {
                path[j] = {
                    x: offsetPolygons[i][j].X / scale,
                    y: offsetPolygons[i][j].Y / scale
                };
            }

            if (path.length > 2) {
               finalCutline.push(path);
            }
        }

        postMessage({ success: true, messageId: messageId, cutline: finalCutline });
    } catch (error) {
        postMessage({ success: false, messageId: messageId, error: error.message });
    }
});
