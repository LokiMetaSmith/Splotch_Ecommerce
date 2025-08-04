import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot;

if (token) {
  // Create a bot that uses 'polling' to fetch new updates
  bot = new TelegramBot(token, { polling: true });
  console.log('Telegram bot is running...');
} else {
  console.warn('[TELEGRAM] Bot token not found. Bot is disabled.');
  // Create a mock bot to avoid errors when the token is not set
  bot = {
    sendMessage: () => Promise.resolve(),
    sendPhoto: () => Promise.resolve(),
    sendDocument: () => Promise.resolve(),
    editMessageText: () => Promise.resolve(),
    deleteMessage: () => Promise.resolve(),
  };
}


export { bot };
