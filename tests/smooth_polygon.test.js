
import { smoothPolygon } from '../src/lib/image-processing.js';

describe('smoothPolygon', () => {
    it('should return points as is if less than 3', () => {
        const points = [{x:0, y:0}, {x:10, y:10}];
        const result = smoothPolygon(points);
        expect(result).toEqual(points);
    });

    it('should double the number of points in one iteration', () => {
        const points = [
            {x:0, y:0},
            {x:10, y:0},
            {x:10, y:10},
            {x:0, y:10}
        ];
        const result = smoothPolygon(points, 1);
        expect(result).toHaveLength(8);
    });

    it('should smooth corners correctly (Chaikin)', () => {
        const points = [
            {x:0, y:0},
            {x:100, y:0},
            {x:100, y:100},
            {x:0, y:100}
        ];
        // 1st iter:
        // P0-P1: 0.75*P0 + 0.25*P1 = 25, 0
        //        0.25*P0 + 0.75*P1 = 75, 0
        const result = smoothPolygon(points, 1);

        // Check first segment points
        expect(result[0]).toEqual({x: 25, y: 0});
        expect(result[1]).toEqual({x: 75, y: 0});

        // Check sharp corners are gone
        expect(result).not.toContainEqual({x:100, y:0});
        expect(result).not.toContainEqual({x:100, y:100});
        expect(result).not.toContainEqual({x:0, y:100});
    });
});
