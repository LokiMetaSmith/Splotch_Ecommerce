import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import { initializeBot } from '../server/bot.js';
import { Context } from 'telegraf';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Telegram Bot Commands', () => {
    let db;
    let bot;
    const testDbPath = path.join(__dirname, 'test-db-telegram-bot.json');

    beforeAll(async () => {
        process.env.TELEGRAM_BOT_TOKEN = 'mock-token';
        process.env.TELEGRAM_CHANNEL_ID = 'mock-channel';
        process.env.NODE_ENV = 'test';

        // Setup clean DB
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {} });

        // Seed some data
        db.data.orders['order-new'] = {
            orderId: 'order-new',
            status: 'NEW',
            amount: 1000,
            currency: 'USD',
            billingContact: { givenName: 'John', familyName: 'Doe', email: 'john@example.com' },
            orderDetails: { quantity: 10 }
        };
        db.data.orders['order-printing'] = {
            orderId: 'order-printing',
            status: 'PRINTING',
            amount: 2000,
            currency: 'USD',
            billingContact: { givenName: 'Jane', familyName: 'Smith', email: 'jane@example.com' },
            orderDetails: { quantity: 20 }
        };
        await db.write();

        bot = initializeBot(db);

        // Override mocks with jest spies
        bot.telegram.sendMessage = jest.fn().mockResolvedValue({ message_id: 123 });
        bot.telegram.editMessageText = jest.fn().mockResolvedValue(true);
        bot.telegram.answerCbQuery = jest.fn().mockResolvedValue(true);
    });

    afterAll(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('should handle /jobs command and list active orders', async () => {
        const update = {
            update_id: 1,
            message: {
                message_id: 1,
                from: { id: 123, is_bot: false, first_name: 'TestUser' },
                chat: { id: 123, type: 'private' },
                date: 1620000000,
                text: '/jobs',
                entities: [{ type: 'bot_command', offset: 0, length: 5 }]
            }
        };

        const ctx = new Context(update, bot.telegram, bot.botInfo);
        await bot.middleware()(ctx, () => Promise.resolve());

        expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
            123, // chat id
            expect.stringContaining('All Active Jobs'),
            expect.objectContaining({ parse_mode: 'HTML' })
        );
        expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
            123,
            expect.stringContaining('order-new'),
            expect.anything()
        );
        expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
            123,
            expect.stringContaining('order-printing'),
            expect.anything()
        );
    });

    it('should handle /new_orders command and list only NEW orders', async () => {
        bot.telegram.sendMessage.mockClear();
        const update = {
            update_id: 2,
            message: {
                message_id: 2,
                from: { id: 123, is_bot: false, first_name: 'TestUser' },
                chat: { id: 123, type: 'private' },
                date: 1620000000,
                text: '/new_orders',
                entities: [{ type: 'bot_command', offset: 0, length: 11 }]
            }
        };

        const ctx = new Context(update, bot.telegram, bot.botInfo);
        await bot.middleware()(ctx, () => Promise.resolve());

        expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
            123,
            expect.stringContaining('New Orders'),
            expect.objectContaining({ parse_mode: 'HTML' })
        );
        expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
            123,
            expect.stringContaining('order-new'),
            expect.anything()
        );
        expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
            123,
            expect.not.stringContaining('order-printing'),
            expect.anything()
        );
    });

    it('should handle callback query to accept order', async () => {
        const update = {
            update_id: 3,
            callback_query: {
                id: 'cb1',
                from: { id: 123, is_bot: false, first_name: 'TestUser' },
                message: { message_id: 999, chat: { id: 123 } },
                data: 'accept_order-new'
            }
        };

        const ctx = new Context(update, bot.telegram, bot.botInfo);
        await bot.middleware()(ctx, () => Promise.resolve());

        // Verify DB update
        const order = db.data.orders['order-new'];
        expect(order.status).toBe('ACCEPTED');

        // Verify message edit
        expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
            123,
            999,
            undefined, // inline_message_id
            expect.stringContaining('Accepted'),
            expect.objectContaining({ reply_markup: expect.anything() })
        );
    });

    it('should handle callback query to print order', async () => {
        const update = {
            update_id: 4,
            callback_query: {
                id: 'cb2',
                from: { id: 123, is_bot: false, first_name: 'TestUser' },
                message: { message_id: 999, chat: { id: 123 } },
                data: 'print_order-new'
            }
        };

        const ctx = new Context(update, bot.telegram, bot.botInfo);
        await bot.middleware()(ctx, () => Promise.resolve());

        const order = db.data.orders['order-new'];
        expect(order.status).toBe('PRINTING');

        expect(bot.telegram.editMessageText).toHaveBeenCalled();
    });
});
