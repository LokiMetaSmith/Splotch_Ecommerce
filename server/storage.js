import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { randomUUID } from 'crypto';

export class StorageProvider {
    /**
     * @returns {object} Multer storage engine or configuration object
     */
    getMulterStorage() {
        throw new Error('Method not implemented');
    }

    /**
     * @param {string} filepath - Relative path or URL to the file
     * @returns {Promise<void>}
     */
    async deleteFile(filepath) {
        throw new Error('Method not implemented');
    }
}

export class LocalStorageProvider extends StorageProvider {
    constructor(uploadDir) {
        super();
        this.uploadDir = uploadDir;
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
    }

    getMulterStorage() {
        return multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, this.uploadDir);
            },
            filename: (req, file, cb) => {
                cb(null, randomUUID() + path.extname(file.originalname));
            }
        });
    }

    async deleteFile(filepath) {
        if (!filepath) return;

        // Handle paths like "/uploads/abc.png" or just "abc.png"
        const filename = path.basename(filepath);
        const fullPath = path.join(this.uploadDir, filename);

        try {
            await fs.promises.unlink(fullPath);
        } catch (err) {
            // Ignore if file doesn't exist
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }
}
