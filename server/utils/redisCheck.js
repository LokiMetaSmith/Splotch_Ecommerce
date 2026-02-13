import net from 'net';
import { URL } from 'url';
import logger from '../logger.js';

/**
 * Checks if a Redis server is available at the given URL or host/port.
 * @param {string} [redisUrl] - The Redis connection string (e.g., redis://localhost:6379).
 * @param {object} [options] - Optional host/port if URL is not provided.
 * @returns {Promise<boolean>} - Resolves to true if connection succeeds, false otherwise.
 */
export async function checkRedisAvailability(redisUrl, options = {}) {
    return new Promise((resolve) => {
        let host = options.host || 'localhost';
        let port = options.port || 6379;

        if (redisUrl) {
            try {
                const parsedUrl = new URL(redisUrl);
                host = parsedUrl.hostname || host;
                port = Number(parsedUrl.port) || port;
            } catch (error) {
                logger.warn(`[REDIS CHECK] Invalid Redis URL provided: ${redisUrl}. Defaulting to localhost:6379.`);
            }
        }

        const socket = new net.Socket();
        socket.setTimeout(2000); // 2 second timeout

        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', (err) => {
            socket.destroy();
            resolve(false);
        });

        try {
            socket.connect(port, host);
        } catch (e) {
            resolve(false);
        }
    });
}
