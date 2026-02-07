import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { getSecret } from './secretManager.js';
import { getOrderStatusKeyboard } from './telegramHelpers.js';
import logger from './logger.js';
import { escapeHtml } from './utils.js';
import { LowDbAdapter } from './database/lowdb_adapter.js';

let bot;

function initializeBot(db, { startPolling = true } = {}) {
  if (db && !db.getOrder) {
      db = new LowDbAdapter(db);
  }

  const token = getSecret('TELEGRAM_BOT_TOKEN');

  if (token) {
    const isTestEnv = process.env.NODE_ENV === 'test';
    bot = new Telegraf(token);

    const listOrdersByStatus = async (ctx, statuses, title) => {
      try {
        const orders = await db.getOrdersByStatus(statuses);

        if (orders.length === 0) {
          ctx.reply(`No orders with status: ${statuses.join(', ')}`)
            .catch(err => logger.error('[TELEGRAM] Error sending message:', err));
          return;
        }

        // SECURITY: Use HTML mode for safer rendering.
        // Note: input variables like billingContact are expected to be HTML-escaped by server.js (using escapeHtml)
        // before being stored in the database. This prevents HTML injection.
        // We switched from Markdown because Markdown characters in user input were not escaped, causing injection.
        let list = `<b>${title}:</b>\n\n`;
        orders.forEach(order => {
          list += `• <b>Order ID:</b> <code>${order.orderId}</code>\n`;
          list += `  <b>Status:</b> ${order.status}\n`;
          list += `  <b>Customer:</b> ${order.billingContact.givenName} ${order.billingContact.familyName}\n\n`;
        });

        ctx.replyWithHTML(list)
           .catch(err => logger.error('[TELEGRAM] Error sending message:', err));
      } catch (error) {
        logger.error('[TELEGRAM] A critical error occurred in listOrdersByStatus:', error);
        ctx.reply('Sorry, an internal error occurred while fetching the order list.')
           .catch(err => logger.error('[TELEGRAM] Error sending critical error message:', err));
      }
    };

    bot.command('jobs', (ctx) => listOrdersByStatus(ctx, ['NEW', 'ACCEPTED', 'PRINTING'], 'All Active Jobs'));
    bot.command('new_orders', (ctx) => listOrdersByStatus(ctx, ['NEW'], 'New Orders'));
    bot.command('in_process_orders', (ctx) => listOrdersByStatus(ctx, ['ACCEPTED', 'PRINTING'], 'In Process Orders'));
    bot.command('shipped_orders', (ctx) => listOrdersByStatus(ctx, ['SHIPPED'], 'Shipped Orders'));
    bot.command('canceled_orders', (ctx) => listOrdersByStatus(ctx, ['CANCELED'], 'Canceled Orders'));
    bot.command('delivered_orders', (ctx) => listOrdersByStatus(ctx, ['DELIVERED'], 'Delivered Orders'));
    bot.command('completed_orders', (ctx) => listOrdersByStatus(ctx, ['COMPLETED'], 'Completed Orders'));

    // Listen for replies to add notes to orders
    bot.on(message('text'), async (ctx) => {
      if (ctx.message.reply_to_message) {
        const originalMessageId = ctx.message.reply_to_message.message_id;
        let order = await db.getOrderByTelegramMessageId(originalMessageId);
        if (!order) {
            order = await db.getOrderByTelegramPhotoMessageId(originalMessageId);
        }

        if (order) {
          if (!order.notes) {
            order.notes = [];
          }
          const note = {
            text: escapeHtml(ctx.message.text),
            from: escapeHtml(ctx.from.username || `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim()),
            date: new Date(ctx.message.date * 1000).toISOString(),
          };
          order.notes.push(note);
          await db.updateOrder(order);

          ctx.reply("Note added successfully!", {
            reply_to_message_id: ctx.message.message_id
          }).catch(err => logger.error('[TELEGRAM] Error sending confirmation message:', err));
        }
      }
    });

    bot.on('callback_query', async (ctx) => {
      const [action, orderId] = ctx.callbackQuery.data.split('_');
      const order = await db.getOrder(orderId);

      if (order) {
        let newStatus;
        switch (action) {
          case 'accept':
            newStatus = 'ACCEPTED';
            break;
          case 'print':
            newStatus = 'PRINTING';
            break;
          case 'ship':
            newStatus = 'SHIPPED';
            break;
          case 'deliver':
            newStatus = 'DELIVERED';
            break;
          case 'complete':
              newStatus = 'COMPLETED';
              break;
          case 'cancel':
            newStatus = 'CANCELED';
            break;
        }

        if (newStatus) {
          order.status = newStatus;
          await db.updateOrder(order);

          const acceptedOrLater = ['ACCEPTED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
          const printingOrLater = ['PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
          const shippedOrLater = ['SHIPPED', 'DELIVERED', 'COMPLETED'];
          const deliveredOrLater = ['DELIVERED', 'COMPLETED'];
          const completedOrLater = ['COMPLETED'];

          const statusChecklist = `
✅ New
${acceptedOrLater.includes(newStatus) ? '✅' : '⬜️'} Accepted
${printingOrLater.includes(newStatus) ? '✅' : '⬜️'} Printing
${shippedOrLater.includes(newStatus) ? '✅' : '⬜️'} Shipped
${deliveredOrLater.includes(newStatus) ? '✅' : '⬜️'} Delivered
${completedOrLater.includes(newStatus) ? '✅' : '⬜️'} Completed
            `;

          const message = `
Order: ${order.orderId}
Customer: ${order.billingContact.givenName} ${order.billingContact.familyName}
Email: ${order.billingContact.email}
Quantity: ${order.orderDetails.quantity}
Amount: $${(order.amount / 100).toFixed(2)}

${statusChecklist}
            `;
          const keyboard = getOrderStatusKeyboard(order);
          ctx.editMessageText(message, { reply_markup: keyboard });
        }
      }
      ctx.answerCbQuery();
    });

    if (!isTestEnv) {
      const commands = [
        { command: 'jobs', description: 'Lists all active jobs' },
        { command: 'new_orders', description: 'Lists all NEW orders' },
        { command: 'in_process_orders', description: 'Lists all ACCEPTED or PRINTING orders' },
        { command: 'shipped_orders', description: 'Lists all SHIPPED orders' },
        { command: 'canceled_orders', description: 'Lists all CANCELED orders' },
        { command: 'delivered_orders', description: 'Lists all DELIVERED orders' },
        { command: 'completed_orders', description: 'Lists all COMPLETED orders' },
      ];
      bot.telegram.setMyCommands(commands);
      if (startPolling) {
          bot.launch();
          logger.info('[BOT] Telegraf bot launched (Polling enabled).');
      } else {
          logger.info('[BOT] Telegraf bot initialized (Polling disabled).');
      }
    } else {
      // In a test environment, we don't launch the bot, but we need to mock the telegram object.
      // Use no-op functions instead of assuming jest.fn() is available, since this code runs in the server process
      // Create a new object to replace bot.telegram
      bot.telegram = {
        sendMessage: () => Promise.resolve(),
        sendPhoto: () => Promise.resolve(),
        sendDocument: () => Promise.resolve(),
        editMessageText: () => Promise.resolve(),
        deleteMessage: () => Promise.resolve(),
        setMyCommands: () => Promise.resolve(),
        getMe: () => Promise.resolve({ id: 123456, is_bot: true, first_name: 'TestBot', username: 'TestBot' }),
      };
      // Manually set botInfo in test environment to satisfy Context constructor requirements
      bot.botInfo = { id: 123456, is_bot: true, first_name: 'TestBot', username: 'TestBot' };
    }

  } else {
    logger.warn('[TELEGRAM] Bot token not found. Bot is disabled.');
    // Create a mock bot to avoid errors when the token is not set
    bot = {
      telegram: {
        sendMessage: () => Promise.resolve(),
        sendPhoto: () => Promise.resolve(),
        sendDocument: () => Promise.resolve(),
        editMessageText: () => Promise.resolve(),
        deleteMessage: () => Promise.resolve(),
        setMyCommands: () => Promise.resolve(),
      },
      command: () => {},
      on: () => {},
      launch: () => {},
      stop: () => {},
    };
  }
  return bot;
}

export { initializeBot };
