import { jest } from '@jest/globals';

// Define mocks before importing the module under test
jest.unstable_mockModule('fs/promises', () => ({
    default: {
        readFile: jest.fn(),
    }
}));

jest.unstable_mockModule('image-size', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('jimp', () => ({
    Jimp: {
        read: jest.fn(),
    }
}));

// Use dynamic import after mocks
const fs = await import('fs/promises');
const imageSize = await import('image-size');
const { Jimp } = await import('jimp');
const { calculateMaterialUsage } = await import('../utils/materialCalculator.js');

describe('Security: Material Calculator DoS Prevention', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should throw an error if the image dimensions are too large (> 50MP)', async () => {
        // Mock a large file buffer
        const largeBuffer = Buffer.from('large-image');
        fs.default.readFile.mockResolvedValue(largeBuffer);

        // Mock image-size to return huge dimensions (e.g. 10,000 x 6,000 = 60MP)
        imageSize.default.mockReturnValue({ width: 10000, height: 6000 });

        // Expect the function to throw a security error
        await expect(calculateMaterialUsage('fake/path/large.png'))
            .rejects
            .toThrow(/Image too large/);

        // Ensure Jimp (the expensive operation) was NOT called
        expect(Jimp.read).not.toHaveBeenCalled();
    });

    it('should proceed with processing for normal sized images', async () => {
        // Mock a normal file buffer
        const normalBuffer = Buffer.from('normal-image');
        fs.default.readFile.mockResolvedValue(normalBuffer);

        // Mock image-size to return safe dimensions (e.g. 1000 x 1000 = 1MP)
        imageSize.default.mockReturnValue({ width: 1000, height: 1000 });

        // Mock Jimp to succeed
        Jimp.read.mockResolvedValue({
            width: 1000,
            height: 1000,
            scaleToFit: jest.fn(), // usage uses scaleToFit
            scan: jest.fn(),       // usage uses scan
            bitmap: { data: new Uint8Array(4) } // minimal data
        });

        // Should not throw the "Image too large" error
        await expect(calculateMaterialUsage('fake/path/normal.png'))
            .resolves
            .toBeTruthy(); // It returns an object
    });
});
