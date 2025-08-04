import { startServer } from './server.js';

const app = await startServer();
const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
  console.log(`[SERVER] Server listening at http://localhost:${port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ [FATAL] Port ${port} is already in use.`);
    console.error('Please close the other process or specify a different port in your .env file.');
    process.exit(1);
  } else {
    console.error(`❌ [FATAL] An unexpected error occurred:`, error);
    process.exit(1);
  }
});
