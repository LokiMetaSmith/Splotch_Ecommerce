
import { drawImageWithFilters } from '../src/lib/canvas-utils.js';
import { jest } from '@jest/globals';

describe('Canvas Utils - drawImageWithFilters', () => {
    let ctxMock;
    let imageMock;

    beforeEach(() => {
        // Mock CanvasRenderingContext2D methods
        ctxMock = {
            clearRect: jest.fn(),
            save: jest.fn(),
            restore: jest.fn(),
            drawImage: jest.fn(),
            // Mock the property 'filter' with a setter to spy on it
            _filter: 'none',
            set filter(val) { this._filter = val; },
            get filter() { return this._filter; }
        };

        // Mock Image object
        imageMock = {};
    });

    test('should apply grayscale filter correctly', () => {
        drawImageWithFilters(ctxMock, imageMock, 100, 100, { grayscale: true });

        expect(ctxMock.save).toHaveBeenCalled();
        expect(ctxMock.filter).toBe('grayscale(100%)');
        expect(ctxMock.drawImage).toHaveBeenCalledWith(imageMock, 0, 0, 100, 100);
        expect(ctxMock.restore).toHaveBeenCalled();
    });

    test('should apply sepia filter correctly', () => {
        drawImageWithFilters(ctxMock, imageMock, 100, 100, { sepia: true });

        expect(ctxMock.save).toHaveBeenCalled();
        expect(ctxMock.filter).toBe('sepia(100%)');
        expect(ctxMock.drawImage).toHaveBeenCalledWith(imageMock, 0, 0, 100, 100);
        expect(ctxMock.restore).toHaveBeenCalled();
    });

    test('should clear filter if no options provided', () => {
        drawImageWithFilters(ctxMock, imageMock, 100, 100, {});

        expect(ctxMock.save).toHaveBeenCalled();
        expect(ctxMock.filter).toBe('none');
        expect(ctxMock.drawImage).toHaveBeenCalledWith(imageMock, 0, 0, 100, 100);
        expect(ctxMock.restore).toHaveBeenCalled();
    });

    test('should do nothing if ctx or image is missing', () => {
        drawImageWithFilters(null, imageMock, 100, 100, {});
        expect(ctxMock.drawImage).not.toHaveBeenCalled();

        drawImageWithFilters(ctxMock, null, 100, 100, {});
        expect(ctxMock.drawImage).not.toHaveBeenCalled();
    });
});
