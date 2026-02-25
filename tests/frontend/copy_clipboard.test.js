/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';

// Mock fetch globally before importing modules that might use it
global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ csrfToken: 'mock-token' })
}));

// Use unstable_mockModule if we needed to mock ES modules before import,
// but since we are modifying the DOM and exporting functions, we can just verify the logic.
// However, the side-effect `document.addEventListener` in src/orders.js will run.

import { displayOrders, setupOrderListHandlers } from '../../src/orders.js';

describe('Copy Order ID Functionality', () => {
    let container;
    let mockClipboard;

    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = '<div id="orders-list"></div>';
        container = document.getElementById('orders-list');

        // Mock Clipboard
        mockClipboard = {
            writeText: jest.fn().mockResolvedValue(undefined)
        };
        Object.assign(navigator, { clipboard: mockClipboard });

        // Setup handlers
        setupOrderListHandlers(container);
    });

    afterEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '';
    });

    test('renders copy button for each order', () => {
        const orders = [
            {
                orderId: '12345678-abcd-1234-ef00-1234567890ab',
                receivedAt: '2023-01-01T00:00:00Z',
                amount: 1000,
                status: 'NEW',
                designImagePath: '/test.png'
            }
        ];

        // Pass null for noOrdersMessage as we don't test it here
        displayOrders(orders, container, null);

        const copyBtn = container.querySelector('.copy-order-id-btn');
        expect(copyBtn).not.toBeNull();
        expect(copyBtn.dataset.orderId).toBe(orders[0].orderId);
        expect(copyBtn.getAttribute('aria-label')).toBe('Copy full Order ID');
    });

    test('copies order ID to clipboard on click', async () => {
        const fullOrderId = '12345678-abcd-1234-ef00-1234567890ab';
        const orders = [
            {
                orderId: fullOrderId,
                receivedAt: '2023-01-01T00:00:00Z',
                amount: 1000,
                status: 'NEW',
                designImagePath: '/test.png'
            }
        ];

        displayOrders(orders, container, null);
        const copyBtn = container.querySelector('.copy-order-id-btn');

        // Simulate click
        copyBtn.click();

        expect(mockClipboard.writeText).toHaveBeenCalledWith(fullOrderId);
    });

    test('shows visual feedback after copy', async () => {
         jest.useFakeTimers();
         const fullOrderId = '12345678-abcd-1234-ef00-1234567890ab';
         const orders = [{ orderId: fullOrderId, receivedAt: '2023-01-01', amount: 100, status: 'NEW', designImagePath: '/img.png' }];

         displayOrders(orders, container, null);
         const copyBtn = container.querySelector('.copy-order-id-btn');
         const originalHTML = copyBtn.innerHTML;

         // Simulate click
         // We trigger the click, which calls the async writeText
         copyBtn.click();

         // writeText returns a promise (mocked). The .then() block runs in microtasks.
         // We need to wait for promises to flush.
         await Promise.resolve();
         await Promise.resolve(); // Extra tick just in case

         // Check feedback state
         expect(copyBtn.innerHTML).not.toBe(originalHTML);
         // Depending on how innerHTML is normalized, we check for class or path
         // Our code: class="w-4 h-4 text-green-600"
         expect(copyBtn.innerHTML).toContain('text-green-600');
         expect(copyBtn.getAttribute('aria-label')).toBe('Copied!');

         // Fast forward timer
         jest.advanceTimersByTime(2000);

         // Check restored state
         expect(copyBtn.innerHTML).toBe(originalHTML);
         expect(copyBtn.getAttribute('aria-label')).toBe('Copy full Order ID');

         jest.useRealTimers();
    });
});
