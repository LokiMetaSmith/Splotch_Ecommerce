import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500 MB max allowed upload size
const MAX_CHUNKS = 1000;                  // Max 1000 chunks allowed per session

export class ChunkedUploadManager {
    constructor(baseDir, logger = console) {
        this.baseDir = path.resolve(baseDir);
        this.logger = logger;
        this.sessions = new Map();

        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    validateUploadId(uploadId) {
        if (!uploadId || typeof uploadId !== 'string' || !UUID_REGEX.test(uploadId)) {
            throw new Error('Invalid upload ID format: must be a valid UUID');
        }
        return uploadId;
    }

    getSessionDir(uploadId) {
        this.validateUploadId(uploadId);
        return path.join(this.baseDir, uploadId);
    }

    initSession({ uploadId, filename, totalSize, totalChunks, mimeType, isCutLine = false }) {
        this.validateUploadId(uploadId);

        if (!filename || typeof filename !== 'string') {
            throw new Error('Invalid filename');
        }

        const size = Number(totalSize);
        if (isNaN(size) || size <= 0 || size > MAX_TOTAL_SIZE) {
            throw new Error(`Total size must be between 1 byte and ${MAX_TOTAL_SIZE / (1024 * 1024)} MB`);
        }

        const chunks = Number(totalChunks);
        if (isNaN(chunks) || chunks < 1 || chunks > MAX_CHUNKS) {
            throw new Error(`Total chunks must be between 1 and ${MAX_CHUNKS}`);
        }

        const sessionDir = this.getSessionDir(uploadId);
        if (fs.existsSync(sessionDir)) {
            throw new Error('Upload session already exists');
        }

        fs.mkdirSync(sessionDir, { recursive: true });

        const session = {
            uploadId,
            filename: path.basename(filename),
            totalSize: size,
            totalChunks: chunks,
            mimeType: mimeType || 'application/octet-stream',
            isCutLine: Boolean(isCutLine),
            receivedChunks: new Set(),
            createdAt: Date.now()
        };

        this.sessions.set(uploadId, session);
        this.logger.info(`[CHUNKED] Initialized session ${uploadId} for file ${session.filename} (${chunks} chunks, ${(size / 1024 / 1024).toFixed(2)} MB)`);
        return session;
    }

    getSession(uploadId) {
        this.validateUploadId(uploadId);
        return this.sessions.get(uploadId) || null;
    }

    async saveChunk(uploadId, chunkIndex, tempFilePath) {
        this.validateUploadId(uploadId);
        const session = this.sessions.get(uploadId);
        if (!session) {
            throw new Error('Upload session not found or expired');
        }

        const index = Number(chunkIndex);
        if (isNaN(index) || index < 0 || index >= session.totalChunks) {
            throw new Error(`Invalid chunk index ${chunkIndex}: must be between 0 and ${session.totalChunks - 1}`);
        }

        const sessionDir = this.getSessionDir(uploadId);
        const targetChunkPath = path.join(sessionDir, `chunk_${index}`);

        // Move the uploaded temp file to the session folder
        await fs.promises.rename(tempFilePath, targetChunkPath);
        session.receivedChunks.add(index);

        this.logger.info(`[CHUNKED] Saved chunk ${index + 1}/${session.totalChunks} for session ${uploadId}`);
        return {
            receivedChunks: session.receivedChunks.size,
            totalChunks: session.totalChunks,
            isComplete: session.receivedChunks.size === session.totalChunks
        };
    }

    isComplete(uploadId) {
        const session = this.getSession(uploadId);
        if (!session) return false;
        return session.receivedChunks.size === session.totalChunks;
    }

    async assembleChunks(uploadId, destinationFilePath) {
        this.validateUploadId(uploadId);
        const session = this.sessions.get(uploadId);
        if (!session) {
            throw new Error('Upload session not found or expired');
        }

        if (session.receivedChunks.size !== session.totalChunks) {
            throw new Error(`Cannot assemble: received ${session.receivedChunks.size} of ${session.totalChunks} chunks`);
        }

        const sessionDir = this.getSessionDir(uploadId);
        const writeStream = fs.createWriteStream(destinationFilePath, { flags: 'w' });

        try {
            for (let i = 0; i < session.totalChunks; i++) {
                const chunkPath = path.join(sessionDir, `chunk_${i}`);
                if (!fs.existsSync(chunkPath)) {
                    throw new Error(`Missing chunk file at index ${i}`);
                }
                const readStream = fs.createReadStream(chunkPath);
                await pipeline(readStream, writeStream, { end: false });
            }
            writeStream.end();
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
        } catch (err) {
            writeStream.destroy();
            // Attempt to clean destination on error
            try { await fs.promises.unlink(destinationFilePath); } catch (e) { /* ignore */ }
            throw err;
        }

        // Clean up session directory and state
        await this.abortSession(uploadId);

        this.logger.info(`[CHUNKED] Successfully assembled all ${session.totalChunks} chunks into ${destinationFilePath}`);
        return {
            filename: session.filename,
            totalSize: session.totalSize,
            isCutLine: session.isCutLine
        };
    }

    async abortSession(uploadId) {
        this.validateUploadId(uploadId);
        const sessionDir = this.getSessionDir(uploadId);

        if (fs.existsSync(sessionDir)) {
            await fs.promises.rm(sessionDir, { recursive: true, force: true });
        }

        this.sessions.delete(uploadId);
        this.logger.info(`[CHUNKED] Aborted and cleaned up session ${uploadId}`);
    }

    async cleanupStaleSessions(maxAgeMs = 2 * 60 * 60 * 1000) {
        const now = Date.now();
        for (const [uploadId, session] of this.sessions.entries()) {
            if (now - session.createdAt > maxAgeMs) {
                this.logger.warn(`[CHUNKED] Cleaning up stale session ${uploadId} (age: ${Math.round((now - session.createdAt) / 60000)}m)`);
                await this.abortSession(uploadId).catch(err => {
                    this.logger.error(`[CHUNKED] Error cleaning stale session ${uploadId}:`, err);
                });
            }
        }

        // Also sweep any orphan directories on disk that are not in memory
        try {
            const entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && UUID_REGEX.test(entry.name)) {
                    const dirPath = path.join(this.baseDir, entry.name);
                    const stats = await fs.promises.stat(dirPath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        this.logger.warn(`[CHUNKED] Removing orphaned chunk directory: ${entry.name}`);
                        await fs.promises.rm(dirPath, { recursive: true, force: true }).catch(() => {});
                    }
                }
            }
        } catch (err) {
            this.logger.error('[CHUNKED] Error sweeping orphan directories:', err);
        }
    }
}
