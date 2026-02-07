import { getOrderStatusKeyboard } from './telegramHelpers.js';
import { getSecret } from './secretManager.js';
import logger from './logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Assuming this file is in server/
const serverRoot = __dirname;

export const sendNewOrderNotification = async (bot, db, orderId) => {
    const CHANNEL_ID = getSecret('TELEGRAM_CHANNEL_ID');
    if (!CHANNEL_ID) return;

    const order = await db.getOrder(orderId);
    if (!order) {
        logger.error(`[NOTIFICATION] Order ${orderId} not found for telegram notification.`);
        return;
    }

    const statusChecklist = `
✅ New
${['ACCEPTED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status) ? '✅' : '⬜️'} Accepted
${['PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status) ? '✅' : '⬜️'} Printing
${['SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status) ? '✅' : '⬜️'} Shipped
${['DELIVERED', 'COMPLETED'].includes(order.status) ? '✅' : '⬜️'} Delivered
${['COMPLETED'].includes(order.status) ? '✅' : '⬜️'} Completed
`;
    const message = `
New Order: ${order.orderId}
Customer: ${order.billingContact.givenName} ${order.billingContact.familyName}
Email: ${order.billingContact.email}
Quantity: ${order.orderDetails.quantity}
Amount: $${(order.amount / 100).toFixed(2)}

${statusChecklist}
  `;
    const keyboard = getOrderStatusKeyboard(order);
    const sentMessage = await bot.telegram.sendMessage(CHANNEL_ID, message, { reply_markup: keyboard });

    // Save message ID immediately to DB to avoid race condition with status updates
    order.telegramMessageId = sentMessage.message_id;
    await db.updateOrder(order);

    // Send design image
    if (order.designImagePath) {
        let photoSource;
        if (order.designImagePath.startsWith('http')) {
            photoSource = { url: order.designImagePath };
        } else {
            // Robustly handle local paths by stripping leading slash
            const relPath = order.designImagePath.startsWith('/') ? order.designImagePath.slice(1) : order.designImagePath;
            photoSource = { source: path.join(serverRoot, relPath) };
        }

        try {
            const sentPhoto = await bot.telegram.sendPhoto(CHANNEL_ID, photoSource);
            order.telegramPhotoMessageId = sentPhoto.message_id;
        } catch (err) {
            logger.error(`[NOTIFICATION] Failed to send photo for order ${orderId}:`, err);
        }
    }

    // Send cut line
    const cutLinePath = order.cutLinePath || (order.orderDetails && order.orderDetails.cutLinePath);
    if (cutLinePath) {
        let docSource;
        if (cutLinePath.startsWith('http')) {
            docSource = { url: cutLinePath };
        } else {
            const relPath = cutLinePath.startsWith('/') ? cutLinePath.slice(1) : cutLinePath;
            docSource = { source: path.join(serverRoot, relPath) };
        }
        try {
            const sentDocument = await bot.telegram.sendDocument(CHANNEL_ID, docSource);
            order.telegramCutLineMessageId = sentDocument.message_id;
        } catch (err) {
            logger.error(`[NOTIFICATION] Failed to send document for order ${orderId}:`, err);
        }
    }

    await db.updateOrder(order);
};

export const updateOrderStatusNotification = async (bot, db, orderId, status) => {
    const CHANNEL_ID = getSecret('TELEGRAM_CHANNEL_ID');
    if (!CHANNEL_ID) return;

    const order = await db.getOrder(orderId);
    if (!order) return;

    if (!order.telegramMessageId) {
        // Throw error to trigger BullMQ retry logic
        // This handles race condition where new-order notification hasn't finished yet
        const msg = `[NOTIFICATION] Order ${orderId} has no telegramMessageId. Retrying.`;
        logger.warn(msg);
        throw new Error(msg);
    }

    const acceptedOrLater = ['ACCEPTED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
    const printingOrLater = ['PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
    const shippedOrLater = ['SHIPPED', 'DELIVERED', 'COMPLETED'];
    const deliveredOrLater = ['DELIVERED', 'COMPLETED'];
    const completedOrLater = ['COMPLETED'];

    const statusChecklist = `
✅ New
${acceptedOrLater.includes(order.status) ? '✅' : '⬜️'} Accepted
${printingOrLater.includes(order.status) ? '✅' : '⬜️'} Printing
${shippedOrLater.includes(order.status) ? '✅' : '⬜️'} Shipped
${deliveredOrLater.includes(order.status) ? '✅' : '⬜️'} Delivered
${completedOrLater.includes(order.status) ? '✅' : '⬜️'} Completed
    `;
    const message = `
Order: ${order.orderId}
Customer: ${order.billingContact.givenName} ${order.billingContact.familyName}
Email: ${order.billingContact.email}
Quantity: ${order.orderDetails?.quantity || 0}
Amount: $${(order.amount / 100).toFixed(2)}

${statusChecklist}
    `;

    if (order.status === 'COMPLETED' || order.status === 'CANCELED') {
        // Use catch to avoid failing the job if message is already deleted
        await bot.telegram.deleteMessage(CHANNEL_ID, order.telegramMessageId).catch(e => logger.warn('[NOTIFICATION] Failed to delete message:', e.message));
        if (order.telegramPhotoMessageId) {
            await bot.telegram.deleteMessage(CHANNEL_ID, order.telegramPhotoMessageId).catch(e => logger.warn('[NOTIFICATION] Failed to delete photo:', e.message));
        }
        if (order.telegramCutLineMessageId) {
            await bot.telegram.deleteMessage(CHANNEL_ID, order.telegramCutLineMessageId).catch(e => logger.warn('[NOTIFICATION] Failed to delete cut line document:', e.message));
        }
    } else {
        const keyboard = getOrderStatusKeyboard(order);
        await bot.telegram.editMessageText(
            CHANNEL_ID,
            order.telegramMessageId,
            undefined,
            message,
            { reply_markup: keyboard }
        ).catch(e => logger.warn('[NOTIFICATION] Failed to edit message:', e.message));

        if (order.status === 'SHIPPED' && order.telegramPhotoMessageId) {
            await bot.telegram.deleteMessage(CHANNEL_ID, order.telegramPhotoMessageId).catch(e => logger.warn('[NOTIFICATION] Failed to delete photo on shipped:', e.message));
        }
        if (order.status === 'SHIPPED' && order.telegramCutLineMessageId) {
            await bot.telegram.deleteMessage(CHANNEL_ID, order.telegramCutLineMessageId).catch(e => logger.warn('[NOTIFICATION] Failed to delete cut line document on shipped:', e.message));
        }
    }
};
