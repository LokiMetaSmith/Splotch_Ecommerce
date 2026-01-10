import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Mock googleapis ---
const mockGenerateAuthUrl = jest.fn();
const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockUserinfoGet = jest.fn();

// Mock OAuth2 constructor
const MockOAuth2 = jest.fn(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    setCredentials: mockSetCredentials,
    credentials: {} // Add credentials property which is accessed in server.js
}));

// Mock google.oauth2
const mockOauth2 = jest.fn(() => ({
    userinfo: {
        get: mockUserinfoGet
    }
}));

jest.unstable_mockModule('googleapis', () => ({
    google: {
        auth: {
            OAuth2: MockOAuth2
        },
        oauth2: mockOauth2
    }
}));

// Import server dynamically AFTER mocking
const { startServer } = await import('../server/server.js');

describe('Google OAuth Endpoints', () => {
    let app;
    let db;
    let serverInstance;
    let timers;
    let bot;
    let mockSendEmail;
    const testDbPath = path.join(__dirname, 'google-oauth-test-db.json');

    beforeAll(async () => {
        // Mock DB using memory instead of file I/O
        const data = { orders: [], users: {}, credentials: {}, config: {}, emailIndex: {} };
        db = {
          data: data,
          write: async () => { /* no-op */ },
          read: async () => { /* no-op */ }
        };

        mockSendEmail = jest.fn();
        const server = await startServer(db, null, mockSendEmail, testDbPath);
        app = server.app;
        timers = server.timers;
        bot = server.bot;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data = { orders: [], users: {}, credentials: {}, config: {}, emailIndex: {} };
        // db.write is no-op
        mockSendEmail.mockClear();
        jest.clearAllMocks();

        // Reset default mock implementations
        mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?test=true');
        mockGetToken.mockResolvedValue({
            tokens: {
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token'
            }
        });
        mockUserinfoGet.mockResolvedValue({
            data: {
                email: 'googleuser@example.com',
                name: 'Google User'
            }
        });

        // Reset the MockOAuth2 instance so we can track calls to a fresh one if needed,
        // although in startServer the instance is created once.
        // Since the server is long-lived in tests, we are interacting with the single instance created at startup.
    });

    afterAll(async () => {
        if (bot) {
            await bot.stop('test');
        }
        timers.forEach(timer => clearInterval(timer));
        await new Promise(resolve => serverInstance.close(resolve));
        try {
            await fs.unlink(testDbPath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    });

    it('should redirect to Google for authentication', async () => {
        const res = await request(app).get('/auth/google');
        expect(res.statusCode).toEqual(302);
        expect(res.headers.location).toBe('https://accounts.google.com/o/oauth2/auth?test=true');
        expect(mockGenerateAuthUrl).toHaveBeenCalled();
    });

    it('should handle OAuth2 callback and log in existing user', async () => {
        // Setup existing user
        const existingUser = {
            id: 'existing-id',
            username: 'googleuser',
            email: 'googleuser@example.com',
            password: null,
            credentials: []
        };
        db.data.users[existingUser.id] = existingUser;
        db.data.emailIndex['googleuser@example.com'] = existingUser.id;
        await db.write();

        const res = await request(app).get('/oauth2callback?code=test-code');

        expect(res.statusCode).toEqual(302);
        expect(res.headers.location).toMatch(/\/printshop\.html\?token=/);

        // Verify token
        const token = new URL(res.headers.location, 'http://localhost').searchParams.get('token');
        const decoded = jwt.decode(token);
        expect(decoded.email).toBe('googleuser@example.com');
        expect(decoded.username).toBe('googleuser');

        // Verify Google API calls
        expect(mockGetToken).toHaveBeenCalledWith('test-code');
        expect(mockUserinfoGet).toHaveBeenCalled();

        // Verify database update (refresh token should be stored in config, and tokens in user)
        await db.read();
        const user = Object.values(db.data.users).find(u => u.email === 'googleuser@example.com');
        expect(user.google_tokens).toBeDefined();
        expect(db.data.config.google_refresh_token).toBe('test-refresh-token');
    });

    it('should handle OAuth2 callback and register new user', async () => {
        const res = await request(app).get('/oauth2callback?code=new-user-code');

        expect(res.statusCode).toEqual(302);
        expect(res.headers.location).toMatch(/\/printshop\.html\?token=/);

        // Verify token
        const token = new URL(res.headers.location, 'http://localhost').searchParams.get('token');
        const decoded = jwt.decode(token);
        expect(decoded.email).toBe('googleuser@example.com');
        expect(decoded.username).toBe('googleuser'); // Default username logic

        // Verify new user creation
        await db.read();
        const user = Object.values(db.data.users).find(u => u.email === 'googleuser@example.com');
        expect(user).toBeDefined();
        expect(user.username).toBe('googleuser');

        // Verify admin notification
        if (process.env.ADMIN_EMAIL) {
             expect(mockSendEmail).toHaveBeenCalled();
             const emailArgs = mockSendEmail.mock.calls[0][0];
             expect(emailArgs.subject).toContain('New User Account Created');
        }
    });
});
