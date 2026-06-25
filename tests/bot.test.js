import { jest, describe, beforeEach, it, expect } from '@jest/globals';

// Define mock functions that will be used by the mock implementation
let mockSendMessage;
let mockOnText;
let mockSetMyCommands;
let mockDeleteMessage;
let mockEditMessageText;

// This setup will now run before each test to ensure a clean state
beforeEach(() => {
  // Reset mocks and module cache
  jest.resetModules();

  // Make the mock function return a Promise to allow .catch()
  mockSendMessage = jest.fn().mockResolvedValue({});
  mockOnText = jest.fn();
  mockSetMyCommands = jest.fn();
  mockDeleteMessage = jest.fn().mockResolvedValue({});
  mockEditMessageText = jest.fn().mockResolvedValue({});

  // Mock the 'node-telegram-bot-api' module before each test
  jest.unstable_mockModule('node-telegram-bot-api', () => ({
    default: jest.fn().mockImplementation(() => {
      return {
        sendMessage: mockSendMessage,
        onText: mockOnText,
        setMyCommands: mockSetMyCommands,
        deleteMessage: mockDeleteMessage,
        editMessageText: mockEditMessageText,
      };
    }),
  }));
});

describe('Telegram Bot', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = {
      data: {
        orders: [
          { orderId: '1', status: 'NEW', billingContact: { givenName: 'John', familyName: 'Doe' } },
          { orderId: '2', status: 'ACCEPTED', billingContact: { givenName: 'Jane', familyName: 'Smith' } },
          { orderId: '3', status: 'PRINTING', billingContact: { givenName: 'Peter', familyName: 'Jones' } },
          { orderId: '4', status: 'SHIPPED', billingContact: { givenName: 'Mary', familyName: 'Jane' } },
          { orderId: '5', status: 'NEW', billingContact: { givenName: 'Zoe', familyName: 'Zebra' } },
        ],
      },
    };
    // Set the environment variable for the bot token
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  });

  it('should initialize the bot and set commands', async () => {
    // Dynamically import modules to get the fresh, mocked versions
    const TelegramBot = (await import('node-telegram-bot-api')).default;
    const { initializeBot } = await import('../server/bot.js');

    initializeBot(mockDb);
    expect(TelegramBot).toHaveBeenCalledWith('test-token', { polling: false });
    expect(mockSetMyCommands).toHaveBeenCalled();
  });

  it('should handle /jobs command and list active jobs', async () => {
    const { initializeBot } = await import('../server/bot.js');
    initializeBot(mockDb);

    const jobsCallback = mockOnText.mock.calls.find(call => call[0].toString() === '/\\/jobs/')[1];
    const mockMsg = { chat: { id: 12345 } };

    jobsCallback(mockMsg, null);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentMessage = mockSendMessage.mock.calls[0][1];
    expect(sentMessage).toMatch(/Order ID:.*1/);
    expect(sentMessage).toMatch(/Order ID:.*2/);
    expect(sentMessage).toMatch(/Order ID:.*3/);
    expect(sentMessage).not.toMatch(/Order ID:.*4/);
  });

  it('should handle /new_orders command', async () => {
    const { initializeBot } = await import('../server/bot.js');
    initializeBot(mockDb);
    const callback = mockOnText.mock.calls.find(call => call[0].toString() === '/\\/new_orders/')[1];
    const mockMsg = { chat: { id: 12345 } };

    callback(mockMsg, null);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentMessage = mockSendMessage.mock.calls[0][1];
    expect(sentMessage).toMatch(/Order ID:.*1/);
    expect(sentMessage).toMatch(/Order ID:.*5/);
    expect(sentMessage).not.toMatch(/Order ID:.*2/);
  });

  it('should handle no orders found for a status', async () => {
    const { initializeBot } = await import('../server/bot.js');
    mockDb.data.orders = []; // No orders
    initializeBot(mockDb);
    const callback = mockOnText.mock.calls.find(call => call[0].toString() === '/\\/shipped_orders/')[1];
    const mockMsg = { chat: { id: 12345 } };

    callback(mockMsg, null);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(12345, 'No orders with status: SHIPPED');
  });
});

describe('handleOrderStatusUpdate', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHANNEL_ID = 'test-channel';
  });

  it('should delete a stalled message when status changes', async () => {
    const { initializeBot, handleOrderStatusUpdate } = await import('../server/bot.js');
    const mockOrder = { orderId: '1', status: 'STALLED', stalledMessageId: 12345 };
    const mockDb = { data: { orders: [mockOrder] }, write: jest.fn() };

    initializeBot(mockDb);
    await handleOrderStatusUpdate(mockOrder, 'ACCEPTED', mockDb);

    expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
    expect(mockDeleteMessage).toHaveBeenCalledWith('test-channel', 12345);
  });

  it('should delete order and image messages on completion', async () => {
    const { initializeBot, handleOrderStatusUpdate } = await import('../server/bot.js');
    const mockOrder = {
      orderId: '1',
      status: 'PRINTING',
      telegramMessageId: 54321,
      telegramImageMessageId: 54322,
      billingContact: { givenName: 'Test', familyName: 'User' },
      orderDetails: { quantity: 10 },
      amount: 500,
    };
    const mockDb = { data: { orders: [mockOrder] }, write: jest.fn() };

    initializeBot(mockDb);
    await handleOrderStatusUpdate(mockOrder, 'COMPLETED', mockDb);

    expect(mockDeleteMessage).toHaveBeenCalledTimes(2);
    expect(mockDeleteMessage).toHaveBeenCalledWith('test-channel', 54321);
    expect(mockDeleteMessage).toHaveBeenCalledWith('test-channel', 54322);
  });

  it('should edit the message for other status updates', async () => {
    const { initializeBot, handleOrderStatusUpdate } = await import('../server/bot.js');
    const mockOrder = {
      orderId: '1',
      status: 'NEW',
      telegramMessageId: 54321,
      billingContact: { givenName: 'Test', familyName: 'User', email: 'test@example.com' },
      orderDetails: { quantity: 10 },
      amount: 500,
    };
    const mockDb = { data: { orders: [mockOrder] }, write: jest.fn() };

    initializeBot(mockDb);
    await handleOrderStatusUpdate(mockOrder, 'PRINTING', mockDb);

    expect(mockEditMessageText).toHaveBeenCalledTimes(1);
    expect(mockDeleteMessage).not.toHaveBeenCalled();
    const sentMessage = mockEditMessageText.mock.calls[0][0];
    expect(sentMessage).toMatch(/✅ Printing/);
  });
});
