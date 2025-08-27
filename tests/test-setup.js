import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHANNEL_ID = 'test-channel';
