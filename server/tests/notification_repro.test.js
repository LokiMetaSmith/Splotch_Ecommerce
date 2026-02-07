import { jest } from '@jest/globals';
import { sendNewOrderNotification, updateOrderStatusNotification } from '../notificationLogic.js';

describe('Notification Logic Reproduction', () => {
    let bot;
    let db;
    let order;

    beforeEach(() => {
        process.env.TELEGRAM_CHANNEL_ID = 'test-channel';
        bot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 100 }),
                sendPhoto: jest.fn().mockResolvedValue({ message_id: 101 }),
                sendDocument: jest.fn().mockResolvedValue({ message_id: 102 }),
                deleteMessage: jest.fn().mockResolvedValue(true),
                editMessageText: jest.fn().mockResolvedValue(true),
            }
        };

        order = {
            orderId: 'order-1',
            status: 'NEW',
            amount: 1000,
            billingContact: { givenName: 'John', familyName: 'Doe', email: 'john@example.com' },
            orderDetails: { quantity: 10 },
            designImagePath: 'http://example.com/image.png',
            cutLinePath: 'http://example.com/cutline.svg',
            telegramMessageId: 200, // Pre-existing message ID
            telegramPhotoMessageId: 201 // Pre-existing photo ID
        };

        db = {
            getOrder: jest.fn().mockResolvedValue(order),
            updateOrder: jest.fn().mockImplementation((updatedOrder) => {
                order = updatedOrder; // update local order object
                return Promise.resolve(updatedOrder);
            })
        };
    });

    it('verifies cut line message ID storage', async () => {
        // Reset order so it mimics a new order being processed
        delete order.telegramMessageId;
        delete order.telegramPhotoMessageId;

        await sendNewOrderNotification(bot, db, order.orderId);

        // Verify sendDocument was called
        expect(bot.telegram.sendDocument).toHaveBeenCalled();

        // Verify order was updated
        expect(db.updateOrder).toHaveBeenCalled();

        // The fix: telegramCutLineMessageId IS saved
        expect(order.telegramCutLineMessageId).toBe(102);
    });

    it('verifies cut line deletion on COMPLETED', async () => {
        order.telegramCutLineMessageId = 300;
        order.status = 'COMPLETED';

        await updateOrderStatusNotification(bot, db, order.orderId, 'COMPLETED');

        // Verify deleteMessage called for main message and photo
        expect(bot.telegram.deleteMessage).toHaveBeenCalledWith('test-channel', 200);
        expect(bot.telegram.deleteMessage).toHaveBeenCalledWith('test-channel', 201);

        // The fix: cut line message IS deleted
        expect(bot.telegram.deleteMessage).toHaveBeenCalledWith('test-channel', 300);
    });

    it('verifies cut line deletion on SHIPPED', async () => {
        order.telegramCutLineMessageId = 300;
        order.status = 'SHIPPED';

        await updateOrderStatusNotification(bot, db, order.orderId, 'SHIPPED');

        // The fix: cut line message IS deleted on SHIPPED
        expect(bot.telegram.deleteMessage).toHaveBeenCalledWith('test-channel', 300);
    });
});
