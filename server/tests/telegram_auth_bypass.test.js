import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Define mocks before imports
const mockReplyWithHTML = jest.fn().mockResolvedValue({});
const mockReply = jest.fn().mockResolvedValue({});
const mockCommand = jest.fn();
const mockSetMyCommands = jest.fn();
const mockOn = jest.fn();
const mockLaunch = jest.fn();
const mockGetChatMember = jest.fn();
const mockAnswerCbQuery = jest.fn();
const mockEditMessageText = jest.fn();
const mockUse = jest.fn();

// Mock secretManager
jest.unstable_mockModule('../secretManager.js', () => ({
  getSecret: jest.fn((key) => {
    if (key === 'TELEGRAM_BOT_TOKEN') return 'mock_token';
    if (key === 'TELEGRAM_CHANNEL_ID') return '-1001234567890';
    return null;
  })
}));

// Mock Telegraf
jest.unstable_mockModule('telegraf', () => {
  return {
    Telegraf: jest.fn().mockImplementation(() => {
      return {
        telegram: {
          setMyCommands: mockSetMyCommands,
          sendMessage: jest.fn().mockResolvedValue({}),
          getChatMember: mockGetChatMember,
          editMessageText: mockEditMessageText,
        },
        command: mockCommand,
        on: mockOn,
        use: mockUse,
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

describe('Telegram Bot Authorization Middleware', () => {
  let db;
  let middleware;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = null;

    // Capture middleware
    mockUse.mockImplementation((fn) => {
      middleware = fn;
    });

    db = {
      data: {
        orders: {}
      },
      write: jest.fn(),
      getOrdersByStatus: jest.fn().mockResolvedValue([]),
      getOrder: jest.fn().mockResolvedValue({ orderId: '123', status: 'NEW' }),
      updateOrder: jest.fn().mockResolvedValue({}),
      getOrderByTelegramMessageId: jest.fn().mockResolvedValue({}),
    };
  });

  it('should BLOCK unauthorized users via middleware', async () => {
    // 1. Initialize Bot
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      initializeBot(db);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    if (!middleware) {
        throw new Error('Middleware not registered');
    }

    // 2. Mock Unauthorized User Context
    const ctx = {
      from: { id: 999999, is_bot: false, first_name: 'Attacker' },
      replyWithHTML: mockReplyWithHTML,
      reply: mockReply,
      telegram: {
          getChatMember: mockGetChatMember
      },
      message: { text: '/jobs' }, // Simulate message
      chat: { type: 'private' }
    };

    // 3. Mock getChatMember to return 'left' (Unauthorized)
    mockGetChatMember.mockResolvedValue({ status: 'left' });

    // 4. Call middleware
    const next = jest.fn();
    await middleware(ctx, next);

    // 5. Assert that next() was NOT called
    expect(next).not.toHaveBeenCalled();
    // Assert that Unauthorized message was sent
    expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));
  });

  it('should ALLOW authorized users via middleware', async () => {
    // 1. Initialize Bot
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      initializeBot(db);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    if (!middleware) {
        throw new Error('Middleware not registered');
    }

    // 2. Mock Authorized User Context
    const ctx = {
      from: { id: 12345, is_bot: false, first_name: 'Admin' },
      replyWithHTML: mockReplyWithHTML,
      reply: mockReply,
      telegram: {
          getChatMember: mockGetChatMember
      },
      message: { text: '/jobs' },
      chat: { type: 'private' }
    };

    // 3. Mock getChatMember to return 'administrator' (Authorized)
    mockGetChatMember.mockResolvedValue({ status: 'administrator' });

    // 4. Call middleware
    const next = jest.fn();
    await middleware(ctx, next);

    // 5. Assert that next() WAS called
    expect(next).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });
});
