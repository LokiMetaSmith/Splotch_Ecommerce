import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const html = readFileSync(path.resolve(__dirname, '..', 'orders.html'), 'utf8');
const scriptContent = readFileSync(path.resolve(__dirname, '..', 'src', 'orders.js'), 'utf8');

describe.skip('Orders Page', () => {
  let dom;
  let window;
  let document;

  function setupDOM(url = "http://localhost:3000/orders.html") {
    dom = new JSDOM(html, { runScripts: "outside-only", resources: "usable", url });
    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;
    global.fetch = jest.fn();
    global.localStorage = window.localStorage;
    global.URLSearchParams = window.URLSearchParams;
    global.URL = window.URL;

    jest.spyOn(window.location, 'assign').mockImplementation(() => {});

    const scriptEl = document.createElement('script');
    scriptEl.textContent = scriptContent;
    document.body.appendChild(scriptEl);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should fetch CSRF token on DOMContentLoaded', async () => {
    setupDOM();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'test-csrf-token' }),
    });
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/csrf-token', { credentials: 'include' });
  });

  test('should verify magic link token and fetch orders', async () => {
    const token = 'test-auth-token';
    setupDOM(`http://localhost:3000/orders.html?token=${token}`);

    global.fetch
      .mockResolvedValueOnce({ // CSRF
        ok: true,
        json: async () => ({ csrfToken: 'test-csrf-token' }),
      })
      .mockResolvedValueOnce({ // my-orders
        ok: true,
        json: async () => ([{ orderId: '123', receivedAt: new Date().toISOString(), amount: 1000, status: 'NEW', designImagePath: '/path/to/image.png', billingContact: { givenName: 'Test', familyName: 'User' }, orderDetails: { quantity: 1 } }]),
      });

    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/orders/my-orders', {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(document.getElementById('orders-list').children.length).toBe(1);
    expect(document.querySelector('.reorder-btn')).not.toBeNull();
  });

  test('should display a message when no orders are found', async () => {
    const token = 'test-auth-token';
    setupDOM(`http://localhost:3000/orders.html?token=${token}`);

    global.fetch
      .mockResolvedValueOnce({ // CSRF
        ok: true,
        json: async () => ({ csrfToken: 'test-csrf-token' }),
      })
      .mockResolvedValueOnce({ // my-orders
        ok: true,
        json: async () => ([]), // No orders
      });

    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 0));

    const noOrdersMessage = document.getElementById('no-orders-message');
    expect(noOrdersMessage.textContent).not.toBe('');
  });

  test('reorder button should call window.location.assign', async () => {
    const token = 'test-auth-token';
    const designImage = '/path/to/reorder-image.png';
    setupDOM(`http://localhost:3000/orders.html?token=${token}`);

    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'test-csrf-token' })})
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ orderId: '456', receivedAt: new Date().toISOString(), amount: 1500, status: 'SHIPPED', designImagePath: designImage, billingContact: { givenName: 'Test', familyName: 'User' }, orderDetails: { quantity: 1 } }])});

    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 0));

    const reorderBtn = document.querySelector('.reorder-btn');
    reorderBtn.click();

    expect(window.location.assign).toHaveBeenCalledWith(`/?design=${encodeURIComponent(designImage)}`);
  });

  test('should send magic link on form submission', async () => {
    setupDOM();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 0)); // Wait for initial CSRF fetch

    const emailInput = document.getElementById('emailInput');
    const loginBtn = document.getElementById('loginBtn');
    const loginStatus = document.getElementById('login-status');

    emailInput.value = 'test@example.com';
    loginBtn.click();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/auth/magic-login', expect.any(Object));
    expect(loginStatus.textContent).toBe('Magic link sent! Please check your email.');
  });
});
