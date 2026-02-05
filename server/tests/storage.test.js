import { jest } from '@jest/globals';
import { Readable } from 'stream';

const mockSend = jest.fn();
const mockS3Client = jest.fn(() => ({
    send: mockSend
}));

// Mock Commands
class MockCommand {
    constructor(input) {
        this.input = input;
    }
}
const MockDeleteObjectCommand = jest.fn().mockImplementation(input => new MockCommand(input));
const MockPutObjectCommand = jest.fn().mockImplementation(input => new MockCommand(input));
const MockGetObjectCommand = jest.fn().mockImplementation(input => new MockCommand(input));

// Mock FS
const mockFs = {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    createReadStream: jest.fn(),
    createWriteStream: jest.fn(),
    promises: {
        unlink: jest.fn().mockResolvedValue(undefined)
    }
};

// Mock Multer
const mockMulter = {
    diskStorage: jest.fn().mockReturnValue('diskStorageInstance')
};

// Mock dependencies
jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
    S3Client: mockS3Client,
    DeleteObjectCommand: MockDeleteObjectCommand,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand
}));
jest.unstable_mockModule('fs', () => ({ default: mockFs }));
jest.unstable_mockModule('multer', () => ({ default: mockMulter }));

const { S3StorageProvider } = await import('../storage.js');

describe('S3StorageProvider', () => {
    let provider;
    const config = {
        bucket: 'test-bucket',
        region: 'test-region',
        accessKeyId: 'key',
        secretAccessKey: 'secret'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockFs.existsSync.mockReturnValue(true); // default temp dir exists
        provider = new S3StorageProvider(config);
    });

    test('constructor initializes S3Client', () => {
        expect(mockS3Client).toHaveBeenCalledWith(expect.objectContaining({
            region: 'test-region',
            credentials: {
                accessKeyId: 'key',
                secretAccessKey: 'secret'
            }
        }));
    });

    test('getMulterStorage returns diskStorage', () => {
        const storage = provider.getMulterStorage();
        expect(mockMulter.diskStorage).toHaveBeenCalled();
        expect(storage).toBe('diskStorageInstance');
    });

    test('deleteFile deletes object from S3', async () => {
        const url = 'https://test-bucket.s3.test-region.amazonaws.com/test-key.png';
        await provider.deleteFile(url);

        expect(MockDeleteObjectCommand).toHaveBeenCalledWith({
            Bucket: 'test-bucket',
            Key: 'test-key.png'
        });
        expect(mockSend).toHaveBeenCalled();
    });

    test('finalizeUpload uploads to S3 and returns URL', async () => {
        const file = {
            path: '/tmp/test-file',
            filename: 'test-file.png',
            mimetype: 'image/png'
        };

        mockFs.createReadStream.mockReturnValue('fileStream');

        const url = await provider.finalizeUpload(file);

        expect(MockPutObjectCommand).toHaveBeenCalledWith({
            Bucket: 'test-bucket',
            Key: 'test-file.png',
            Body: 'fileStream',
            ContentType: 'image/png',
            ACL: 'public-read'
        });
        expect(mockSend).toHaveBeenCalled();
        expect(mockFs.promises.unlink).toHaveBeenCalledWith('/tmp/test-file');
        expect(url).toBe('https://test-bucket.s3.test-region.amazonaws.com/test-file.png');
    });

    test('getLocalCopy downloads from S3 if it is a URL', async () => {
        const url = 'https://test-bucket.s3.test-region.amazonaws.com/test-key.png';

        const mockStream = new Readable();
        mockStream._read = () => {};
        mockStream.pipe = jest.fn(); // Stub pipe

        mockSend.mockResolvedValue({ Body: mockStream });

        const mockWriter = {
            on: jest.fn()
        };
        mockFs.createWriteStream.mockReturnValue(mockWriter);

        // We assume file doesn't exist locally first
        mockFs.existsSync.mockReturnValue(false);

        const promise = provider.getLocalCopy(url);

        // Wait for async execution
        await new Promise(process.nextTick);

        expect(MockGetObjectCommand).toHaveBeenCalledWith({
            Bucket: 'test-bucket',
            Key: 'test-key.png'
        });

        expect(mockStream.pipe).toHaveBeenCalledWith(mockWriter);

        // Find the finish callback and call it
        const finishCallback = mockWriter.on.mock.calls.find(call => call[0] === 'finish')[1];
        finishCallback();

        const localPath = await promise;
        expect(localPath).toContain('download-test-key.png');
    });

    test('getLocalCopy returns input if not a URL', async () => {
        const path = '/local/path/file.png';
        const result = await provider.getLocalCopy(path);
        expect(result).toBe(path);
        expect(mockSend).not.toHaveBeenCalled();
    });
});
