import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Define mocks before imports
const mockReplyWithMarkdown = jest.fn().mockResolvedValue({});
const mockReplyWithHTML = jest.fn().mockResolvedValue({});
const mockReply = jest.fn().mockResolvedValue({});
const mockCommand = jest.fn();
const mockSetMyCommands = jest.fn();
const mockOn = jest.fn();
const mockLaunch = jest.fn();

// Mock secretManager
jest.unstable_mockModule('../secretManager.js', () => ({
  getSecret: jest.fn((key) => {
    console.log(`[TEST] getSecret called with ${key}`);
    if (key === 'TELEGRAM_BOT_TOKEN') return 'mock_token';
    return null;
  })
}));

// Mock Telegraf
jest.unstable_mockModule('telegraf', () => {
  return {
    Telegraf: jest.fn().mockImplementation(() => {
      console.log('[TEST] Telegraf constructor called');
      return {
        telegram: {
          setMyCommands: mockSetMyCommands,
          sendMessage: jest.fn().mockResolvedValue({}),
          getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' }),
        },
        command: mockCommand,
        on: mockOn,
        use: jest.fn(),
        launch: mockLaunch,
      };
    }),
    Markup: {
        button: { callback: jest.fn() },
        inlineKeyboard: jest.fn()
    }
  };
});

// Mock telegraf/filters
jest.unstable_mockModule('telegraf/filters', () => ({
  message: jest.fn(() => 'message_filter')
}));

// Import the module under test AFTER mocking
const { initializeBot } = await import('../bot.js');

describe('Telegram Bot Security', () => {
  let db;
  let commands = {};

  beforeEach(() => {
    jest.clearAllMocks();
    commands = {}; // Clear commands

    // Capture command handlers
    mockCommand.mockImplementation((cmd, handler) => {
      console.log(`[TEST] Registered command: ${cmd}`);
      commands[cmd] = handler;
    });

    db = {
      data: {
        orders: {}
      },
      write: jest.fn()
    };
  });

  it('should be vulnerable to Markdown injection (Reproducing Vulnerability)', async () => {
    // 1. Initialize Bot
    // Force NODE_ENV to development so bot.js registers commands
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      initializeBot(db);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    // 2. Setup malicious data
    const maliciousOrder = {
      orderId: 'order-123',
      status: 'NEW',
      billingContact: {
        givenName: '*Bold*',
        familyName: '_Italic_',
        email: 'test@example.com'
      },
      orderDetails: { quantity: 10 },
      amount: 1000
    };
    db.data.orders['order-123'] = maliciousOrder;

    // 3. Mock Context
    const ctx = {
      replyWithMarkdown: mockReplyWithMarkdown,
      replyWithHTML: mockReplyWithHTML,
      reply: mockReply
    };

    // 4. Trigger the 'jobs' command
    if (commands['jobs']) {
      await commands['jobs'](ctx);
    } else {
      throw new Error('jobs command not registered');
    }

    // 5. Assert that replyWithHTML was called (Safe)
    expect(mockReplyWithHTML).toHaveBeenCalled();
    expect(mockReplyWithMarkdown).not.toHaveBeenCalled();

    const message = mockReplyWithHTML.mock.calls[0][0];

    // Verify that the message uses HTML tags and includes the content
    // Note: The content itself (*Bold*) is rendered as text because we expect it to be safe in HTML context
    // (or at least not cause Markdown injection).
    expect(message).toContain('<b>Customer:</b> *Bold* _Italic_');
  });
});
