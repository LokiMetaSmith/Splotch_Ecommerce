import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import os from 'os';

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

    /**
     * Moves a file from temporary storage to final storage (if applicable).
     * @param {object} file - The multer file object
     * @returns {Promise<string>} - The final path or URL
     */
    async finalizeUpload(file) {
        throw new Error('Method not implemented');
    }

    /**
     * Ensures the file is available locally for processing.
     * @param {string} pathOrUrl - The file path or URL
     * @returns {Promise<string>} - Local file path
     */
    async getLocalCopy(pathOrUrl) {
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

    async finalizeUpload(file) {
        // For local storage, the file is already in place.
        // We return the relative path that the server expects (/uploads/filename)
        // If the file was renamed during processing, file.filename might need updating by the caller,
        // but here we just return the formatted path based on the current file object state.
        return `/uploads/${file.filename}`;
    }

    async getLocalCopy(pathOrUrl) {
        // Handle local paths
        let localPath = pathOrUrl;
        if (localPath.startsWith('/uploads/')) {
             localPath = path.join(this.uploadDir, path.basename(localPath));
        } else if (localPath.startsWith('http')) {
            throw new Error('LocalStorageProvider cannot handle remote URLs');
        }

        // If the path is relative and not starting with /uploads/, assume it is a direct path
        // but verify it exists.

        if (!fs.existsSync(localPath)) {
            // Try resolving against uploadDir just in case
            const inUploads = path.join(this.uploadDir, path.basename(localPath));
            if (fs.existsSync(inUploads)) {
                return inUploads;
            }
        }

        return localPath;
    }
}

export class S3StorageProvider extends StorageProvider {
    constructor(config) {
        super();
        this.bucket = config.bucket;
        this.region = config.region;
        this.endpoint = config.endpoint; // Optional (for DigitalOcean Spaces, MinIO)

        const s3Config = {
            region: this.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            }
        };

        if (this.endpoint) {
            s3Config.endpoint = this.endpoint;
            // s3Config.forcePathStyle = true; // DO Spaces usually works with this, but let's leave it to default/auto
        }

        this.client = new S3Client(s3Config);

        // Temp dir for uploads before finalize
        this.tempDir = path.join(os.tmpdir(), 'splotch-uploads');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    getMulterStorage() {
        // We use diskStorage for the initial upload to allow local processing
        return multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, this.tempDir);
            },
            filename: (req, file, cb) => {
                cb(null, randomUUID() + path.extname(file.originalname));
            }
        });
    }

    async deleteFile(filepath) {
        if (!filepath) return;

        try {
            const url = new URL(filepath);
            const key = path.basename(url.pathname);

            await this.client.send(new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key
            }));
        } catch (e) {
            // Fallback for local cleanup if it was a temp file
            if (!filepath.startsWith('http')) {
                 try {
                    await fs.promises.unlink(filepath);
                } catch (err) { /* ignore */ }
            }
        }
    }

    async finalizeUpload(file) {
        // file is the multer file object (which points to temp local file)
        const fileContent = fs.createReadStream(file.path);
        const key = file.filename;

        const uploadParams = {
            Bucket: this.bucket,
            Key: key,
            Body: fileContent,
            ContentType: file.mimetype,
            ACL: 'public-read'
        };

        await this.client.send(new PutObjectCommand(uploadParams));

        // Delete local temp file
        try {
            await fs.promises.unlink(file.path);
        } catch (e) {
            // console.error('Failed to delete temp file:', e);
        }

        // Return URL
        if (this.endpoint) {
             // For DO Spaces or similar: https://bucket.region.digitaloceanspaces.com/key
             // We construct it based on common patterns.
             // If endpoint is https://nyc3.digitaloceanspaces.com
             const endpointUrl = new URL(this.endpoint);
             return `${endpointUrl.protocol}//${this.bucket}.${endpointUrl.host}/${key}`;
        }
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }

    async getLocalCopy(pathOrUrl) {
        if (!pathOrUrl.startsWith('http')) {
            // It's a local path
            return pathOrUrl;
        }

        // Download from S3 to temp
        const key = path.basename(new URL(pathOrUrl).pathname);
        const tempPath = path.join(this.tempDir, `download-${key}`);

        // Check if we already have it? (Caching)
        if (fs.existsSync(tempPath)) {
            return tempPath;
        }

        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key
        });

        const response = await this.client.send(command);

        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(tempPath);
            if (response.Body instanceof Readable) {
                response.Body.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            } else {
                // In Node.js, Body is usually a stream.
                // In some SDK versions it might be a Blob or other.
                // client-s3 v3 in Node environment returns IncomingMessage (stream).
                // @aws-sdk/client-s3 returns sdk-stream-mixin which is iterable/stream.
                response.Body.pipe(writer);
                 writer.on('finish', resolve);
                writer.on('error', reject);
            }
        });

        return tempPath;
    }
}
