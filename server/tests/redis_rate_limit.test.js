
import { jest, describe, it, expect, beforeAll } from '@jest/globals';

// Mocks must be defined before imports
// We need to mock redis, connect-redis, rate-limit-redis, and express-rate-limit

// Mock Redis Client
const mockSendCommand = jest.fn();
const mockConnect = jest.fn().mockResolvedValue();
const mockOn = jest.fn();
const mockCreateClient = jest.fn(() => ({
    connect: mockConnect,
    on: mockOn,
    sendCommand: mockSendCommand
}));

// Mock ConnectRedisStore
const MockConnectRedisStore = jest.fn(() => ({
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    destroy: jest.fn(),
    all: jest.fn(),
    length: jest.fn(),
    clear: jest.fn(),
    touch: jest.fn()
}));

// Mock RateLimitRedisStore
const MockRateLimitRedisStore = jest.fn();

// Mock rateLimit
const mockRateLimit = jest.fn((options) => (req, res, next) => next());

jest.unstable_mockModule('redis', () => ({
    createClient: mockCreateClient
}));

jest.unstable_mockModule('connect-redis', () => ({
    RedisStore: MockConnectRedisStore
}));

jest.unstable_mockModule('rate-limit-redis', () => ({
    RedisStore: MockRateLimitRedisStore
}));

jest.unstable_mockModule('express-rate-limit', () => ({
    default: mockRateLimit
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
    default: {
        sign: jest.fn(() => 'mock_token'),
        verify: jest.fn((token, key, opts, cb) => cb(null, { username: 'testuser', email: 'test@example.com' })),
        decode: jest.fn(() => ({ header: { kid: 'kid' }, payload: {} }))
    }
}));

// Mock other dependencies to avoid side effects during server start
jest.unstable_mockModule('../utils/redisCheck.js', () => ({
    checkRedisAvailability: jest.fn().mockResolvedValue(true)
}));
jest.unstable_mockModule('../email.js', () => ({
    sendEmail: jest.fn()
}));
jest.unstable_mockModule('../bot.js', () => ({
    initializeBot: jest.fn()
}));
jest.unstable_mockModule('../tracker.js', () => ({
    initializeTracker: jest.fn()
}));
jest.unstable_mockModule('../keyManager.js', () => ({
    getCurrentSigningKey: jest.fn(() => ({ privateKey: 'key', kid: 'kid', publicKey: 'pub' })),
    getJwks: jest.fn(),
    rotateKeys: jest.fn(),
    getKey: jest.fn(),
    KEY_ROTATION_MS: 1000
}));

jest.unstable_mockModule('../utils/redisCheck.js', () => ({
    checkRedisAvailability: jest.fn(() => Promise.resolve(true))
}));

// Set REDIS_URL to trigger redis logic
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.SESSION_SECRET = 'test-secret';
process.env.SQUARE_ACCESS_TOKEN = 'test-token'; // To pass startup check
process.env.NODE_ENV = 'test';
process.env.TEST_USE_REAL_REDIS = 'true';

describe('Distributed Rate Limiting', () => {
    it('should initialize Redis client and use RedisStore for rate limiting when REDIS_URL is present', async () => {
        // Dynamic import to apply mocks
        const { startServer } = await import('../server.js');

        const db = {
            data: { orders: {}, users: {}, config: {}, emailIndex: {}, credentials: {}, products: {} },
            write: jest.fn()
        };

        const server = await startServer(db, null);
        if (server.timers) server.timers.forEach(t => clearInterval(t));

        // Verify Redis Client created and connected
        expect(mockCreateClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
        expect(mockConnect).toHaveBeenCalled();

        // Verify ConnectRedisStore initialized
        expect(MockConnectRedisStore).toHaveBeenCalled();

        // Verify MockRateLimitRedisStore was instantiated
        expect(MockRateLimitRedisStore).toHaveBeenCalled();

        const storeCalls = MockRateLimitRedisStore.mock.calls;
        // Check for correct prefixes
        const apiStoreCall = storeCalls.find(call => call[0].prefix === 'rl:api:');
        const authStoreCall = storeCalls.find(call => call[0].prefix === 'rl:auth:');

        expect(apiStoreCall).toBeDefined();
        expect(authStoreCall).toBeDefined();

        // Verify sendCommand wrapper logic
        if (apiStoreCall) {
            const sendCmdWrapper = apiStoreCall[0].sendCommand;
            sendCmdWrapper('test_arg');
            expect(mockSendCommand).toHaveBeenCalledWith(['test_arg']);
        }

        // Verify rateLimit was called with the stores
        const rateLimitCalls = mockRateLimit.mock.calls;
        const callsWithStore = rateLimitCalls.filter(call => call[0].store !== undefined);
        expect(callsWithStore.length).toBeGreaterThanOrEqual(2);
    });
});
