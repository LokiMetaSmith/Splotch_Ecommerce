import { describe, it, expect } from '@jest/globals';
import { ChunkedUploadManager } from '../utils/chunkedUploader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ChunkedUploadManager', () => {
    describe('validateUploadId', () => {
        const uploadDir = path.join(__dirname, 'test-uploads');
        const manager = new ChunkedUploadManager(uploadDir);

        it('should return the uploadId if it is a valid UUID', () => {
            const validUUID = '123e4567-e89b-12d3-a456-426614174000';
            expect(manager.validateUploadId(validUUID)).toBe(validUUID);
        });

        it('should throw an error if uploadId is null', () => {
            expect(() => manager.validateUploadId(null)).toThrow('Invalid upload ID format: must be a valid UUID');
        });

        it('should throw an error if uploadId is undefined', () => {
            expect(() => manager.validateUploadId(undefined)).toThrow('Invalid upload ID format: must be a valid UUID');
        });

        it('should throw an error if uploadId is empty string', () => {
            expect(() => manager.validateUploadId('')).toThrow('Invalid upload ID format: must be a valid UUID');
        });

        it('should throw an error if uploadId is not a string', () => {
            expect(() => manager.validateUploadId(123)).toThrow('Invalid upload ID format: must be a valid UUID');
            expect(() => manager.validateUploadId({})).toThrow('Invalid upload ID format: must be a valid UUID');
        });

        it('should throw an error if uploadId is an invalid UUID string', () => {
            expect(() => manager.validateUploadId('invalid-uuid')).toThrow('Invalid upload ID format: must be a valid UUID');
            expect(() => manager.validateUploadId('123e4567-e89b-12d3-a456-42661417400')).toThrow('Invalid upload ID format: must be a valid UUID'); // too short
            expect(() => manager.validateUploadId('123e4567-e89b-12d3-a456-4266141740000')).toThrow('Invalid upload ID format: must be a valid UUID'); // too long
            expect(() => manager.validateUploadId('123e4567-e89b-62d3-a456-426614174000')).toThrow('Invalid upload ID format: must be a valid UUID'); // invalid version (6)
        });
    });
});
