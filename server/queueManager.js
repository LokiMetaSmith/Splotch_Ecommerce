import { Queue } from 'bullmq';
import { getSecret } from './secretManager.js';
import logger from './logger.js';

const redisUrl = getSecret('REDIS_URL');

// Connection logic: Use URL if provided, otherwise default to local.
// BullMQ handles connection automatically if we pass connection options.
export let connection;

if (redisUrl) {
    try {
        const urlObj = new URL(redisUrl);
        connection = {
            host: urlObj.hostname,
            port: Number(urlObj.port) || 6379,
            password: urlObj.password || undefined,
            username: urlObj.username || undefined,
            db: 0 // Default Redis DB
        };
    } catch (e) {
        logger.error(`[QUEUE] Invalid REDIS_URL: ${redisUrl}`, e);
        connection = { host: 'localhost', port: 6379 };
    }
} else {
    connection = { host: 'localhost', port: 6379 };
}

// Check if we are in a test environment (and not an integration test with real redis)
// If so, we might want to mock the queue, but for now we'll assume the environment provides Redis or mocks.

const defaultJobOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 1000,
    },
    removeOnComplete: {
        age: 3600, // keep for 1 hour
        count: 100, // keep max 100 jobs
    },
    removeOnFail: {
        age: 24 * 3600, // keep for 24 hours
    }
};

let emailQueueInstance, telegramQueueInstance, odooQueueInstance;

// Only use real Redis in test if explicitly requested
const useRealRedisInTest = process.env.TEST_USE_REAL_REDIS === 'true';

if (process.env.NODE_ENV === 'test' && (!redisUrl || !useRealRedisInTest)) {
    logger.info('[QUEUE] Test environment detected. Using Mock Queues.');
    class MockQueue {
        constructor(name) { this.name = name; }
        async add(name, data) {
            // In test mode, we might want to execute the job immediately if needed,
            // but usually we just want to verify it was added.
            // For now, simple mock.
            return { id: 'mock-job-id', name, data };
        }
        on() {}
        close() {}
    }
    emailQueueInstance = new MockQueue('email-queue');
    telegramQueueInstance = new MockQueue('telegram-queue');
    odooQueueInstance = new MockQueue('odoo-queue');
} else {
    emailQueueInstance = new Queue('email-queue', {
        connection,
        defaultJobOptions
    });

    telegramQueueInstance = new Queue('telegram-queue', {
        connection,
        defaultJobOptions
    });

    odooQueueInstance = new Queue('odoo-queue', {
        connection,
        defaultJobOptions
    });

    emailQueueInstance.on('error', (err) => {
        if (process.env.NODE_ENV !== 'test') {
            logger.error('[QUEUE] Email Queue Error:', err);
        }
    });

    telegramQueueInstance.on('error', (err) => {
        if (process.env.NODE_ENV !== 'test') {
            logger.error('[QUEUE] Telegram Queue Error:', err);
        }
    });

    odooQueueInstance.on('error', (err) => {
        if (process.env.NODE_ENV !== 'test') {
            logger.error('[QUEUE] Odoo Queue Error:', err);
        }
    });
    logger.info(`[QUEUE] Queues initialized with Redis at ${connection.host}:${connection.port}`);
}

export const emailQueue = emailQueueInstance;
export const telegramQueue = telegramQueueInstance;
export const odooQueue = odooQueueInstance;
