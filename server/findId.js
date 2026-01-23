// findId.js
import { Telegraf } from 'telegraf';
import { getSecret } from './secretManager.js';

const token = getSecret('TELEGRAM_BOT_TOKEN');

if (!token) {
    console.error("Error: TELEGRAM_BOT_TOKEN is not set in your .env file.");
    process.exit(1);
}

const bot = new Telegraf(token);

console.log('ID Finder Bot is running. Send or forward a message to it...');

bot.on('message', (ctx) => {
  console.log('--- NEW MESSAGE RECEIVED ---');
  // In Telegraf, the message object is at ctx.message
  console.log(JSON.stringify(ctx.message, null, 2));
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch();
