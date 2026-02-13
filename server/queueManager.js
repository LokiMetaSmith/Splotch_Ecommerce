import { Queue as BullQueue, Worker as BullWorker } from 'bullmq';
import { checkRedisAvailability } from './utils/redisCheck.js';
import { getSecret } from './secretManager.js';
import logger from './logger.js';
import { EventEmitter } from 'events';
import { URL } from 'url';

const redisUrl = getSecret('REDIS_URL');

// Determine if we should use Redis
let useRedis = false;
if (process.env.NO_REDIS === 'true') {
    logger.info('[QUEUE] NO_REDIS=true. Using in-memory queues.');
} else {
    // Check if Redis is available using top-level await
    const isAvailable = await checkRedisAvailability(redisUrl);
    if (isAvailable) {
        useRedis = true;
        logger.info(`[QUEUE] Redis is available. Using BullMQ.`);
    } else {
        logger.warn('[QUEUE] Redis unavailable. Falling back to in-memory queues.');
    }
}

export const redisAvailable = useRedis;

let connection;
if (useRedis) {
    if (redisUrl) {
        try {
            const urlObj = new URL(redisUrl);
            connection = {
                host: urlObj.hostname,
                port: Number(urlObj.port) || 6379,
                password: urlObj.password || undefined,
                username: urlObj.username || undefined,
                db: 0
            };
        } catch (e) {
             logger.warn(`[QUEUE] Invalid REDIS_URL "${redisUrl}". Defaulting to localhost:6379.`);
             connection = { host: 'localhost', port: 6379 };
        }
    } else {
        connection = { host: 'localhost', port: 6379 };
    }
}

// Mock Implementation
const queues = new Map(); // name -> { jobs: [], processor: fn }

class MockQueue extends EventEmitter {
    constructor(name) {
        super();
        this.name = name;
        if (!queues.has(name)) {
            queues.set(name, { jobs: [], processor: null });
        }
    }

    async add(name, data, opts) {
        const job = { id: Date.now().toString(), name, data, opts };
        const q = queues.get(this.name);
        q.jobs.push(job);

        // If processor is registered, trigger it (next tick)
        if (q.processor) {
            setImmediate(() => this.processNext(this.name));
        }
        return job;
    }

    async processNext(queueName) {
        const q = queues.get(queueName);
        if (q && q.processor && q.jobs.length > 0) {
            const job = q.jobs.shift();
            try {
                await q.processor(job);
            } catch (err) {
                logger.error(`[MOCK WORKER] Job ${job.name} failed: ${err.message}`);
            }
            // Continue processing
            if (q.jobs.length > 0) {
                setImmediate(() => this.processNext(queueName));
            }
        }
    }

    close() { return Promise.resolve(); }
}

class MockWorker extends EventEmitter {
    constructor(name, processor, opts) {
        super();
        this.name = name;
        this.processor = processor;

        if (!queues.has(name)) {
            queues.set(name, { jobs: [], processor: null });
        }
        const q = queues.get(name);
        q.processor = processor;

        // Start processing any pending jobs
        if (q.jobs.length > 0) {
             const mockQueue = new MockQueue(name);
             setImmediate(() => mockQueue.processNext(name));
        }
    }

    close() { return Promise.resolve(); }
}


// Export the classes
export const Queue = useRedis ? BullQueue : MockQueue;
export const Worker = useRedis ? BullWorker : MockWorker;
export { connection };

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 24 * 3600 }
};

// Instantiate queues using the selected class
export const emailQueue = new Queue('email-queue', useRedis ? { connection, defaultJobOptions } : {});
export const telegramQueue = new Queue('telegram-queue', useRedis ? { connection, defaultJobOptions } : {});
export const odooQueue = new Queue('odoo-queue', useRedis ? { connection, defaultJobOptions } : {});

// Log errors if using real Redis
if (useRedis) {
    emailQueue.on('error', (err) => logger.error('[QUEUE] Email Queue Error:', err));
    telegramQueue.on('error', (err) => logger.error('[QUEUE] Telegram Queue Error:', err));
    odooQueue.on('error', (err) => logger.error('[QUEUE] Odoo Queue Error:', err));
}
