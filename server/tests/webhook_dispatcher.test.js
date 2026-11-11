import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { dispatchOrderWebhook } from '../lib/webhook_dispatcher.js';

describe('Webhook Dispatcher', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('should return false and not fetch if webhookUrl is invalid or missing', async () => {
    global.fetch = jest.fn();
    const order = { orderId: 'test1' };
    const result = await dispatchOrderWebhook(order, 'order.created');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should block non-canonical IPv4 URLs due to security validation', async () => {
    global.fetch = jest.fn();
    // 0x7f000001 is 127.0.0.1 in hex, which should be blocked
    const order = { orderId: 'test2', webhookUrl: 'http://0x7f000001/webhook' };
    const result = await dispatchOrderWebhook(order, 'order.created');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should block URLs with fullwidth digits due to security validation', async () => {
    global.fetch = jest.fn();
    // \uFF11 is fullwidth digit '1'
    const order = { orderId: 'test2', webhookUrl: `http://example.com\uFF11/webhook` };
    const result = await dispatchOrderWebhook(order, 'order.created');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should successfully dispatch to a valid URL', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const order = { orderId: 'test3', webhookUrl: 'https://example.com/webhook', amount: 1500 };
    const result = await dispatchOrderWebhook(order, 'order.created');
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Check payload details
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://example.com/webhook');
    const opts = callArgs[1];
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.orderId).toBe('test3');
    expect(body.event).toBe('order.created');
    expect(body.amountUsd).toBe('15.00');
  });

  it('should retry on failure and eventually succeed', async () => {
    jest.useFakeTimers();
    // Fail first attempt, succeed second
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const order = { orderId: 'test4', webhookUrl: 'https://example.com/webhook' };

    // Start the promise
    const promise = dispatchOrderWebhook(order, 'order.created');

    // Fast-forward timers to trigger retries
    // We await microtasks between timer advances to let async/await continue
    await Promise.resolve(); // let first fetch finish
    jest.advanceTimersByTime(1000); // Wait first backoff (1000ms)
    await Promise.resolve(); // let setTimeout resolve and second fetch start

    const result = await promise;
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should exhaust retries on persistent failure and return false', async () => {
    jest.useFakeTimers();
    // Always fail
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    const order = { orderId: 'test5', webhookUrl: 'https://example.com/webhook' };

    // Start the promise
    const promise = dispatchOrderWebhook(order, 'order.created');

    // attempt 1
    await Promise.resolve();
    jest.runAllTimers();

    // attempt 2
    await Promise.resolve();
    jest.runAllTimers();

    // attempt 3
    await Promise.resolve();
    jest.runAllTimers();

    const result = await promise;
    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });
});
