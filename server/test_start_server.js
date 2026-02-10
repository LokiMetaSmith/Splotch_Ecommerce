import { startServer } from './server.js';
import logger from './logger.js';

async function test() {
    try {
        console.log('Starting server...');
        const result = await startServer();
        console.log('Server started:', result ? 'OK' : 'FAIL');
        if (result) {
            result.timers.forEach(t => clearInterval(t));
            process.exit(0);
        }
    } catch (e) {
        console.error('Start server failed:', e);
        process.exit(1);
    }
}
test();
