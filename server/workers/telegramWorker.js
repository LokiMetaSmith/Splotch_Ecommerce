import { Worker, connection } from '../queueManager.js';
import logger from '../logger.js';
import { sendNewOrderNotification, updateOrderStatusNotification } from '../notificationLogic.js';

let worker;

export const startTelegramWorker = (bot, db) => {
    if (worker) return worker;

    worker = new Worker('telegram-queue', async (job) => {
        logger.info(`[WORKER] Processing telegram job ${job.id} (${job.name})`);
        const { type, ...data } = job.data;

        try {
            if (job.name === 'send-new-order') {
                const { orderId } = data;
                await sendNewOrderNotification(bot, db, orderId);
            } else if (job.name === 'update-status') {
                const { orderId, status } = data;
                // The status argument is redundant as logic fetches order from DB,
                // but we keep it for consistency or if logic changes to use it.
                // However, notificationLogic uses order.status from DB.
                await updateOrderStatusNotification(bot, db, orderId, status);
            }
            logger.info(`[WORKER] Telegram job ${job.id} completed.`);
        } catch (error) {
             logger.error(`[WORKER] Telegram job ${job.id} failed:`, error);
             throw error;
        }
    }, {
        connection,
        concurrency: 5
    });

    worker.on('failed', (job, err) => {
         logger.error(`[WORKER] Telegram job ${job.id} failed with error ${err.message}`);
    });

    logger.info('[WORKER] Telegram worker started.');
    return worker;
};
