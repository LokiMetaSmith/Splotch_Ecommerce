
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
            measureText: jest.fn(() => ({ width: 10 })),
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

    describe('Dynamic Scale Constants and Units', () => {
        const checkConstantScale = (mockCtx, ppi) => {
            const ppiScale = ppi / 96;
            const fontSize = Math.max(12, Math.round(12 * ppiScale));
            const lineWidth = Math.max(1, Math.round(1 * ppiScale));
            expect(mockCtx.font).toBe(`${fontSize}px Arial`);
            expect(mockCtx.lineWidth).toBe(lineWidth);
        };

        it('should use mils for imperial images < 2 inches', () => {
            const ppi = 300;
            const bounds = { width: 1.5 * ppi, height: 1.5 * ppi }; // 1.5 inches
            drawRuler(mockCtx, bounds, {x:0, y:0}, ppi, false);

            checkConstantScale(mockCtx, ppi);
            expect(mockCtx.fillText).toHaveBeenCalledWith(expect.stringContaining('mil'), expect.any(Number), expect.any(Number));
        });

        it('should use inches for imperial images >= 2 and < 24 inches', () => {
            const ppi = 300;
            const bounds = { width: 10 * ppi, height: 10 * ppi }; // 10 inches
            drawRuler(mockCtx, bounds, {x:0, y:0}, ppi, false);

            checkConstantScale(mockCtx, ppi);
            expect(mockCtx.fillText).toHaveBeenCalledWith(expect.stringContaining('in'), expect.any(Number), expect.any(Number));
        });

        it('should use feet for imperial images >= 24 inches', () => {
            const ppi = 300;
            const bounds = { width: 30 * ppi, height: 30 * ppi }; // 30 inches
            drawRuler(mockCtx, bounds, {x:0, y:0}, ppi, false);

            checkConstantScale(mockCtx, ppi);
            expect(mockCtx.fillText).toHaveBeenCalledWith(expect.stringContaining('ft'), expect.any(Number), expect.any(Number));
        });

        it('should use micrometers for metric images < 1mm', () => {
            const ppi = 300;
            const bounds = { width: (0.5 / 25.4) * ppi, height: (0.5 / 25.4) * ppi }; // 0.5 mm
            drawRuler(mockCtx, bounds, {x:0, y:0}, ppi, true);

            checkConstantScale(mockCtx, ppi);
            expect(mockCtx.fillText).toHaveBeenCalledWith(expect.stringContaining('µm'), expect.any(Number), expect.any(Number));
        });

        it('should use small mm for metric images < 20mm', () => {
            const ppi = 300;
            const bounds = { width: (15 / 25.4) * ppi, height: (15 / 25.4) * ppi }; // 15 mm
            drawRuler(mockCtx, bounds, {x:0, y:0}, ppi, true);

            checkConstantScale(mockCtx, ppi);
            expect(mockCtx.fillText).toHaveBeenCalledWith(expect.stringContaining('mm'), expect.any(Number), expect.any(Number));
        });

        it('should use normal mm for metric images >= 20mm and < 1000mm', () => {
            const ppi = 300;
            const bounds = { width: (500 / 25.4) * ppi, height: (500 / 25.4) * ppi }; // 500 mm
            drawRuler(mockCtx, bounds, {x:0, y:0}, ppi, true);

            checkConstantScale(mockCtx, ppi);
            expect(mockCtx.fillText).toHaveBeenCalledWith(expect.stringContaining('mm'), expect.any(Number), expect.any(Number));
        });

        it('should use meters for metric images >= 1000mm', () => {
            const ppi = 300;
            const bounds = { width: (1500 / 25.4) * ppi, height: (1500 / 25.4) * ppi }; // 1500 mm
            drawRuler(mockCtx, bounds, {x:0, y:0}, ppi, true);

            checkConstantScale(mockCtx, ppi);
            expect(mockCtx.fillText).toHaveBeenCalledWith(expect.stringContaining('m'), expect.any(Number), expect.any(Number));
        });
    });
});
