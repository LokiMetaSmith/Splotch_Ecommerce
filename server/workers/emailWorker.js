import { Worker, connection } from '../queueManager.js';
import { sendEmail } from '../email.js';
import logger from '../logger.js';

let worker;

export const startEmailWorker = (oauth2Client, emailSender = sendEmail, db = null) => {
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

            if (error.message === 'invalid_grant' || (error.response?.data?.error === 'invalid_grant')) {
                if (db) {
                    logger.warn('[WORKER] Google OAuth2 token is invalid or revoked. Clearing stored token.');
                    try {
                        await db.setConfig('google_refresh_token', null);
                        if (oauth2Client) {
                            oauth2Client.setCredentials({});
                        }
                    } catch (dbErr) {
                        logger.error('[WORKER] Failed to clear invalid google_refresh_token:', dbErr);
                    }
                }
                return; // Do not retry if the token is revoked
            }

            if (error.message === 'No access, refresh token, API key or refresh handler callback is set.') {
                logger.warn('[WORKER] No Google OAuth2 credentials. Cannot send email.');
                return; // Do not retry if there are no credentials
            }

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
