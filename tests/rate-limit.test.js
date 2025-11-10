
import request from 'supertest';
import { startServer } from '../server/server.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Rate Limiting', () => {
  let app;
  let server;
  let dbPath;
  let timers; // To hold the server timers

  beforeAll(async () => {
    dbPath = path.join(__dirname, 'test-db-rate-limit.json');
    // Clean up old db file if it exists
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    const serverInstance = await startServer(null, null, null, dbPath);
    app = serverInstance.app;
    timers = serverInstance.timers; // Capture the timers
    server = app.listen(0); // Listen on a random free port
  });

  afterAll((done) => {
    // Explicitly clear the timers to allow a graceful shutdown
    timers.forEach(timer => clearInterval(timer));
    server.close(() => {
      // Clean up the test database
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      done();
    });
  });

  it('should block login requests after 5 attempts in a minute', async () => {
    // First, register a user to test login
    await request(app)
      .post('/api/auth/register-user')
      .send({ username: 'rate-limit-user', password: 'password123' });

    const loginCredentials = { username: 'rate-limit-user', password: 'password123' };

    // Make 5 successful login attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send(loginCredentials)
        .expect(200);
    }

    // The 6th attempt should be blocked
    const response = await request(app)
      .post('/api/auth/login')
      .send(loginCredentials);

    expect(response.status).toBe(429);
    expect(response.text).toBe('Too many login attempts. Please try again after a minute.');
  });
});
