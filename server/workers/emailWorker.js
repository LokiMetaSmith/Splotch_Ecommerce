import { Worker, connection } from '../queueManager.js';
import { sendEmail } from '../email.js';
import logger from '../logger.js';

let worker;

export const startEmailWorker = (oauth2Client, emailSender = sendEmail) => {
    if (worker) return worker;

    worker = new Worker('email-queue', async (job) => {
        logger.info(`[WORKER] Processing email job ${job.id}`);
        try {
            await emailSender({
                ...job.data,
                oauth2Client
            });
            logger.info(`[WORKER] Email job ${job.id} completed.`);
        } catch (error) {
            logger.error(`[WORKER] Email job ${job.id} failed:`, error);
            throw error; // Let BullMQ handle retries
        }
    }, {
        connection,
        concurrency: 5 // Process up to 5 emails concurrently
    });

    worker.on('failed', (job, err) => {
        logger.error(`[WORKER] Email job ${job.id} failed with error ${err.message}`);
    });

    logger.info('[WORKER] Email worker started.');
    return worker;
};
