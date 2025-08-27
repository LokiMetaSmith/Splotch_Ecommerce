import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot;
let db;

function initializeBot(database) {
  db = database;
  if (token) {
    const isTestEnv = process.env.NODE_ENV === 'test';
    // Create a bot that uses 'polling' to fetch new updates, but disable it for tests.
    bot = new TelegramBot(token, { polling: !isTestEnv });

    if (!isTestEnv) {
      console.log('Telegram bot is running...');
    }

    const commands = [
      { command: 'jobs', description: 'Lists all active jobs' },
      { command: 'new_orders', description: 'Lists all NEW orders' },
      { command: 'in_process_orders', description: 'Lists all ACCEPTED or PRINTING orders' },
      { command: 'shipped_orders', description: 'Lists all SHIPPED orders' },
      { command: 'canceled_orders', description: 'Lists all CANCELED orders' },
      { command: 'delivered_orders', description: 'Lists all DELIVERED orders' },
    ];
    bot.setMyCommands(commands);

    const listOrdersByStatus = (chatId, statuses, title) => {
        try {
            const orders = db.data.orders.filter(o => statuses.includes(o.status));

            if (orders.length === 0) {
                bot.sendMessage(chatId, `No orders with status: ${statuses.join(', ')}`)
                   .catch(err => console.error('[TELEGRAM] Error sending message:', err));
                return;
            }

            let list = `*${title}:*\n\n`;
            orders.forEach(order => {
                list += `• *Order ID:* ${order.orderId.substring(0, 8)}...\n`;
                list += `  *Status:* ${order.status}\n`;
                list += `  *Customer:* ${order.billingContact.givenName} ${order.billingContact.familyName}\n\n`;
            });

            bot.sendMessage(chatId, list, { parse_mode: 'Markdown' })
               .catch(err => console.error('[TELEGRAM] Error sending message:', err));
        } catch (error) {
            console.error('[TELEGRAM] A critical error occurred in listOrdersByStatus:', error);
            bot.sendMessage(chatId, 'Sorry, an internal error occurred while fetching the order list.')
               .catch(err => console.error('[TELEGRAM] Error sending critical error message:', err));
        }
    };

    // Listen for the /jobs command
    bot.onText(/\/jobs/, (msg) => {
      listOrdersByStatus(msg.chat.id, ['NEW', 'ACCEPTED', 'PRINTING'], 'All Active Jobs');
    });

    bot.onText(/\/new_orders/, (msg) => {
        listOrdersByStatus(msg.chat.id, ['NEW'], 'New Orders');
    });

    bot.onText(/\/in_process_orders/, (msg) => {
        listOrdersByStatus(msg.chat.id, ['ACCEPTED', 'PRINTING'], 'In Process Orders');
    });

    bot.onText(/\/shipped_orders/, (msg) => {
        listOrdersByStatus(msg.chat.id, ['SHIPPED'], 'Shipped Orders');
    });

    bot.onText(/\/canceled_orders/, (msg) => {
        listOrdersByStatus(msg.chat.id, ['CANCELED'], 'Canceled Orders');
    });

    bot.onText(/\/delivered_orders/, (msg) => {
        listOrdersByStatus(msg.chat.id, ['DELIVERED'], 'Delivered Orders');
    });

  } else {
    console.warn('[TELEGRAM] Bot token not found. Bot is disabled.');
    // Create a mock bot to avoid errors when the token is not set
    bot = {
      sendMessage: () => Promise.resolve(),
      sendPhoto: () => Promise.resolve(),
      sendDocument: () => Promise.resolve(),
      editMessageText: () => Promise.resolve(),
      deleteMessage: () => Promise.resolve(),
      onText: () => {},
      setMyCommands: () => {},
      isPolling: () => false,
      stopPolling: () => {},
    };
  }
  return bot;
}

async function handleOrderStatusUpdate(order, newStatus, db) {
  // If the order was stalled, delete the 'stalled' message
  if (order.stalledMessageId) {
    try {
      await bot.deleteMessage(process.env.TELEGRAM_CHANNEL_ID, order.stalledMessageId);
      const orderInDb = db.data.orders.find(o => o.orderId === order.orderId);
      if (orderInDb) {
        orderInDb.stalledMessageId = null; // Clear the ID after deleting
        await db.write();
      }
    } catch (error) {
      if (error.response && error.response.body && error.response.body.description.includes('message to delete not found')) {
        console.log(`[TELEGRAM] Stalled message for order ${order.orderId} was already deleted.`);
      } else {
        console.error('[TELEGRAM] Failed to delete stalled message:', error);
      }
    }
  }

  // Update Telegram message
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID && order.telegramMessageId) {
    const statusChecklist = `
✅ New
${newStatus === 'ACCEPTED' || newStatus === 'PRINTING' || newStatus === 'SHIPPED' ? '✅' : '⬜️'} Accepted
${newStatus === 'PRINTING' || newStatus === 'SHIPPED' ? '✅' : '⬜️'} Printing
${newStatus === 'SHIPPED' ? '✅' : '⬜️'} Shipped
    `;
    const message = `
Order: ${order.orderId}
Customer: ${order.billingContact.givenName} ${order.billingContact.familyName}
Email: ${order.billingContact.email}
Quantity: ${order.orderDetails.quantity}
Amount: $${(order.amount / 100).toFixed(2)}

${statusChecklist}
    `;
    try {
      if (newStatus === 'SHIPPED' || newStatus === 'COMPLETED' || newStatus === 'CANCELED') {
        if (order.telegramMessageId) {
          await bot.deleteMessage(process.env.TELEGRAM_CHANNEL_ID, order.telegramMessageId);
        }
        if (order.telegramImageMessageId) {
          await bot.deleteMessage(process.env.TELEGRAM_CHANNEL_ID, order.telegramImageMessageId);
        }
      } else {
        await bot.editMessageText(message, {
          chat_id: process.env.TELEGRAM_CHANNEL_ID,
          message_id: order.telegramMessageId,
        });
      }
    } catch (error) {
      console.error('[TELEGRAM] Failed to edit or delete message:', error);
    }
  }
}

export { initializeBot, bot, handleOrderStatusUpdate };
