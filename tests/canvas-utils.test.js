
import { jest } from '@jest/globals';
import { drawRuler } from '../src/lib/canvas-utils.js';

describe('Canvas Utils: drawRuler', () => {
    let mockCtx;

    beforeEach(() => {
        mockCtx = {
            save: jest.fn(),
            restore: jest.fn(),
            beginPath: jest.fn(),
            moveTo: jest.fn(),
            lineTo: jest.fn(),
            stroke: jest.fn(),
            fillText: jest.fn(),
            strokeStyle: '',
            fillStyle: '',
            font: '',
            lineWidth: 0,
        };
    });

    it('should calculate correct spacing for imperial units', () => {
        const bounds = { width: 300, height: 300 }; // 1x1 inch at 300 DPI
        const offset = { x: 0, y: 0 };
        const ppi = 300;
        const isMetric = false;

        drawRuler(mockCtx, bounds, offset, ppi, isMetric);

        // Major mark spacing = 300px
        // Minor mark spacing = 300 / 8 = 37.5px

        // Verify stroke was called exactly twice (once for top, once for left)
        expect(mockCtx.stroke).toHaveBeenCalledTimes(2);

        // Verify some path operations
        expect(mockCtx.beginPath).toHaveBeenCalledTimes(2);
        expect(mockCtx.moveTo).toHaveBeenCalled();
        expect(mockCtx.lineTo).toHaveBeenCalled();
    });

    it('should calculate correct spacing for metric units', () => {
        const bounds = { width: 300, height: 300 };
        const offset = { x: 0, y: 0 };
        const ppi = 300; // ~11.8 px per mm
        const isMetric = true;

        drawRuler(mockCtx, bounds, offset, ppi, isMetric);

        // Major mark spacing = 10 * 300 / 25.4 = ~118.11px (10mm)
        // Minor mark spacing = ~11.81px (1mm)

        expect(mockCtx.stroke).toHaveBeenCalledTimes(2);
    });

    it('should do nothing if parameters are missing', () => {
        drawRuler(null, { width: 100 }, {}, 96, false);
        drawRuler(mockCtx, null, {}, 96, false);
        drawRuler(mockCtx, { width: 100 }, {}, null, false);

        expect(mockCtx.save).not.toHaveBeenCalled();
    });

    it('should draw labels for major marks', () => {
        const bounds = { width: 300, height: 300 };
        const offset = { x: 0, y: 0 };
        const ppi = 100; // Simple PPI
        const isMetric = false;

        // Minor spacing = 100 / 8 = 12.5
        // Major marks at 0, 100, 200, 300
        // Labels at 100, 200, 300 (0 skipped)

        drawRuler(mockCtx, bounds, offset, ppi, isMetric);

        // Check for fillText calls
        expect(mockCtx.fillText).toHaveBeenCalled();
    });
});
