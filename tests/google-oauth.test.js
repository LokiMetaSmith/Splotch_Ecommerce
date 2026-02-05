import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import server dynamically
const { startServer } = await import('../server/server.js');

describe('Google OAuth Endpoints', () => {
    let app;
    let db;
    let serverInstance;
    let timers;
    let bot;
    let mockSendEmail;
    const testDbPath = path.join(__dirname, 'google-oauth-test-db.json');
    let mockGoogle;
    let mockOAuth2Instance;

    beforeAll(async () => {
        // Mock DB using memory instead of file I/O
        const data = { orders: {}, users: {}, credentials: {}, config: {}, emailIndex: {} };
        db = {
          data: data,
          write: async () => { /* no-op */ },
          read: async () => { /* no-op */ }
        };

        mockSendEmail = jest.fn();

        // Create Mocks for Google
        mockOAuth2Instance = {
            generateAuthUrl: jest.fn(),
            getToken: jest.fn(),
            setCredentials: jest.fn(),
            credentials: {}
        };

        const mockOAuth2Constructor = jest.fn(() => mockOAuth2Instance);
        const mockUserinfoGet = jest.fn();

        mockGoogle = {
            auth: {
                OAuth2: mockOAuth2Constructor
            },
            oauth2: jest.fn(() => ({
                userinfo: {
                    get: mockUserinfoGet
                }
            }))
        };

        // Inject mockGoogle
        const server = await startServer(db, null, mockSendEmail, testDbPath, null, mockGoogle);
        app = server.app;
        timers = server.timers;
        bot = server.bot;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data = { orders: {}, users: {}, credentials: {}, config: {}, emailIndex: {} };
        mockSendEmail.mockClear();
        jest.clearAllMocks();

        // Reset default mock implementations for the INSTANCE
        mockOAuth2Instance.generateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?test=true');
        mockOAuth2Instance.getToken.mockResolvedValue({
            tokens: {
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token'
            }
        });

        // Re-setup the mockUserinfoGet (since it's nested in the factory result)
        const oauth2Client = mockGoogle.oauth2(); // Get the object returned by mockGoogle.oauth2
        oauth2Client.userinfo.get.mockResolvedValue({
            data: {
                email: 'googleuser@example.com',
                name: 'Google User'
            }
        });
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
        expect(mockOAuth2Instance.generateAuthUrl).toHaveBeenCalled();
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
        // db.write is mocked to no-op

        // 1. Initiate flow to get state and cookie
        const agent = request.agent(app);
        await agent.get('/auth/google');

        // Capture the state passed to generateAuthUrl
        const generateAuthUrlArgs = mockOAuth2Instance.generateAuthUrl.mock.calls[0][0];
        const state = generateAuthUrlArgs.state;
        expect(state).toBeDefined();

        // 2. Callback with correct state
        const res = await agent.get(`/oauth2callback?code=test-code&state=${state}`);

        expect(res.statusCode).toEqual(302);
        expect(res.headers.location).toMatch(/\/printshop\.html\?token=/);

        // Verify token
        const token = new URL(res.headers.location, 'http://localhost').searchParams.get('token');
        const decoded = jwt.decode(token);
        expect(decoded.email).toBe('googleuser@example.com');
        expect(decoded.username).toBe('googleuser');

        // Verify Google API calls
        expect(mockOAuth2Instance.getToken).toHaveBeenCalledWith('test-code');
        // Check if oauth2() was called
        expect(mockGoogle.oauth2).toHaveBeenCalled();
        // Check if userinfo.get was called
        const oauth2Client = mockGoogle.oauth2.mock.results[0].value;
        expect(oauth2Client.userinfo.get).toHaveBeenCalled();

        // Verify database update
        // Since db is in memory, check it directly
        const user = Object.values(db.data.users).find(u => u.email === 'googleuser@example.com');
        expect(user.google_tokens).toBeDefined();
        expect(db.data.config.google_refresh_token).toBe('test-refresh-token');
    });

    it('should handle OAuth2 callback and register new user', async () => {
        // 1. Initiate flow to get state and cookie
        const agent = request.agent(app);
        await agent.get('/auth/google');

        // Capture the state passed to generateAuthUrl
        const generateAuthUrlArgs = mockOAuth2Instance.generateAuthUrl.mock.calls[0][0];
        const state = generateAuthUrlArgs.state;
        expect(state).toBeDefined();

        // 2. Callback with correct state
        const res = await agent.get(`/oauth2callback?code=new-user-code&state=${state}`);

        expect(res.statusCode).toEqual(302);
        expect(res.headers.location).toMatch(/\/printshop\.html\?token=/);

        // Verify token
        const token = new URL(res.headers.location, 'http://localhost').searchParams.get('token');
        const decoded = jwt.decode(token);
        expect(decoded.email).toBe('googleuser@example.com');
        expect(decoded.username).toBe('googleuser'); // Default username logic

        // Verify new user creation
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

    it('should reject callback with invalid state', async () => {
        const agent = request.agent(app);
        await agent.get('/auth/google');
        // Ignore the valid state, use a fake one

        const res = await agent.get('/oauth2callback?code=test-code&state=invalid-state');
        expect(res.statusCode).toEqual(403);
        expect(res.text).toContain('Invalid state parameter');
    });
});
