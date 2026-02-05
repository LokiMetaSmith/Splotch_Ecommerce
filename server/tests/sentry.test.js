
import { jest } from '@jest/globals';

// Use unstable_mockModule for ESM mocking
jest.unstable_mockModule('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  setupExpressErrorHandler: jest.fn(),
}));

jest.unstable_mockModule('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: jest.fn(),
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    sign: jest.fn().mockReturnValue('mock_token'),
    verify: jest.fn(),
    decode: jest.fn(),
  },
  sign: jest.fn().mockReturnValue('mock_token'),
  verify: jest.fn(),
  decode: jest.fn(),
}));

jest.unstable_mockModule('../bot.js', () => ({
  initializeBot: jest.fn().mockReturnValue({ telegram: { sendMessage: jest.fn() } }),
}));

jest.unstable_mockModule('../tracker.js', () => ({
  initializeTracker: jest.fn(),
  updateTrackingData: jest.fn(),
  stopTracker: jest.fn(),
}));

jest.unstable_mockModule('../keyManager.js', () => ({
  getCurrentSigningKey: jest.fn().mockReturnValue({ privateKey: 'mockKey', kid: 'mockKid', publicKey: 'mockPublicKey' }),
  getJwks: jest.fn(),
  rotateKeys: jest.fn(),
  getKey: jest.fn(),
  KEY_ROTATION_MS: 3600000,
}));

jest.unstable_mockModule('lowdb/node', () => ({
  JSONFilePreset: jest.fn().mockResolvedValue({
    data: { orders: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} },
    write: jest.fn(),
  }),
}));

// Import modules AFTER mocking
const Sentry = await import('@sentry/node');
const { startServer } = await import('../server.js');
const Tracker = await import('../tracker.js'); // Import namespace to inspect

describe('Sentry Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.SESSION_SECRET = 'test_session_secret';
    process.env.CSRF_SECRET = '12345678901234567890123456789012';
    // Fix square access token requirement for test
    process.env.SQUARE_ACCESS_TOKEN = 'test_token';
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.SQUARE_ACCESS_TOKEN;
  });

  test('should initialize Sentry when SENTRY_DSN is provided', async () => {
    await startServer();
    expect(Sentry.init).toHaveBeenCalled();
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
        dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0'
    }));
    expect(Sentry.setupExpressErrorHandler).toHaveBeenCalled();
  });

  test('should NOT initialize Sentry when SENTRY_DSN is missing', async () => {
    delete process.env.SENTRY_DSN;
    await startServer();
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.setupExpressErrorHandler).not.toHaveBeenCalled();
  });

  test('should capture exceptions in logAndEmailError when Sentry is enabled', async () => {
    const error = new Error('Forced Crash');

    // Access the mock from the namespace
    // console.log('Tracker.initializeTracker:', Tracker.initializeTracker);

    if (jest.isMockFunction(Tracker.initializeTracker)) {
        Tracker.initializeTracker.mockImplementationOnce(() => { throw error; });
    } else {
        throw new Error('initializeTracker is not a mock function!');
    }

    // Suppress console.error/info for this test
    const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spyInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
    const spyExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

    await startServer();

    expect(Sentry.captureException).toHaveBeenCalledWith(error, expect.objectContaining({
        tags: { context: 'FATAL: Failed to start server' }
    }));

    spyError.mockRestore();
    spyInfo.mockRestore();
    spyExit.mockRestore();
  });

  test('should NOT capture exceptions in logAndEmailError when SENTRY_DSN is missing', async () => {
    delete process.env.SENTRY_DSN;

    const error = new Error('Forced Crash 2');
    if (jest.isMockFunction(Tracker.initializeTracker)) {
        Tracker.initializeTracker.mockImplementationOnce(() => { throw error; });
    }

    const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spyInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
    const spyExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

    await startServer();

    expect(Sentry.captureException).not.toHaveBeenCalled();

    spyError.mockRestore();
    spyInfo.mockRestore();
    spyExit.mockRestore();
  });
});
