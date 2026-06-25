// findId.js
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

// Load environment variables from your .env file
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error("Error: TELEGRAM_BOT_TOKEN is not set in your .env file.");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('ID Finder Bot is running. Send or forward a message to it...');

bot.on('message', (msg) => {
  console.log('--- NEW MESSAGE RECEIVED ---');
  // This will print the entire message object in a readable format
  console.log(JSON.stringify(msg, null, 2));
});