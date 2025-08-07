import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
      {
        command: 'jobs',
        description: 'Lists available jobs to do',
      },
    ];
    bot.setMyCommands(commands);

    // Listen for the /jobs command
    bot.onText(/\/jobs/, (msg) => {
      const chatId = msg.chat.id;
      const orders = db.data.orders.filter(o => o.status !== 'SHIPPED' && o.status !== 'CANCELED');

      if (orders.length === 0) {
        bot.sendMessage(chatId, 'No active jobs.');
        return;
      }

      let jobsList = '*Current Jobs:*\n\n';
      orders.forEach(order => {
        jobsList += `• *Order ID:* ${order.orderId.substring(0, 8)}...\n`;
        jobsList += `  *Status:* ${order.status}\n`;
        jobsList += `  *Customer:* ${order.billingContact.givenName} ${order.billingContact.familyName}\n\n`;
      });

      bot.sendMessage(chatId, jobsList, { parse_mode: 'Markdown' });
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
    };
  }
  return bot;
}

export { initializeBot, bot };
