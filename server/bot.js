import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { getOrderStatusKeyboard } from './telegramHelpers.js';

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot;
let db;

function initializeBot(database) {
  db = database;
  if (token) {
    const isTestEnv = process.env.NODE_ENV === 'test';
    bot = new Telegraf(token);

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

      const listOrdersByStatus = (ctx, statuses, title) => {
        try {
          const orders = Object.values(db.data.orders).filter(o => statuses.includes(o.status));

          if (orders.length === 0) {
            ctx.reply(`No orders with status: ${statuses.join(', ')}`)
              .catch(err => console.error('[TELEGRAM] Error sending message:', err));
            return;
          }

          let list = `*${title}:*\n\n`;
          orders.forEach(order => {
            list += `• *Order ID:* \`${order.orderId}\`\n`;
            list += `  *Status:* ${order.status}\n`;
            list += `  *Customer:* ${order.billingContact.givenName} ${order.billingContact.familyName}\n\n`;
          });

          ctx.replyWithMarkdown(list)
             .catch(err => console.error('[TELEGRAM] Error sending message:', err));
        } catch (error) {
          console.error('[TELEGRAM] A critical error occurred in listOrdersByStatus:', error);
          ctx.reply('Sorry, an internal error occurred while fetching the order list.')
             .catch(err => console.error('[TELEGRAM] Error sending critical error message:', err));
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
          const order = Object.values(db.data.orders).find(o => o.telegramMessageId === originalMessageId || o.telegramPhotoMessageId === originalMessageId);

          if (order) {
            if (!order.notes) {
              order.notes = [];
            }
            const note = {
              text: ctx.message.text,
              from: ctx.from.username || `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim(),
              date: new Date(ctx.message.date * 1000).toISOString(),
            };
            order.notes.push(note);
            await db.write();

            ctx.reply("Note added successfully!", {
              reply_to_message_id: ctx.message.message_id
            }).catch(err => console.error('[TELEGRAM] Error sending confirmation message:', err));
          }
        }
      });

      bot.on('callback_query', async (ctx) => {
        const [action, orderId] = ctx.callbackQuery.data.split('_');
        const order = db.data.orders[orderId];

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
            await db.write();

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

      bot.launch();
      console.log('[BOT] Telegraf bot launched.');
    } else {
      // In a test environment, we don't launch the bot, but we need to mock the telegram object.
      bot.telegram = {
        sendMessage: jest.fn(),
        sendPhoto: jest.fn(),
        sendDocument: jest.fn(),
        editMessageText: jest.fn(),
        deleteMessage: jest.fn(),
      };
    }

  } else {
    console.warn('[TELEGRAM] Bot token not found. Bot is disabled.');
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
