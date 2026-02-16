
/** @jest-environment jsdom */
import { describe, test, expect, beforeAll, jest } from '@jest/globals';

// Mocks
jest.unstable_mockModule('jose', () => ({}));
jest.unstable_mockModule('jspdf', () => ({ jsPDF: jest.fn() }));
jest.unstable_mockModule('svg2pdf.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@simplewebauthn/browser', () => ({
    startRegistration: jest.fn(),
    startAuthentication: jest.fn()
}));

// Mock fetch
global.fetch = jest.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
    })
);

// Dynamic import to allow hoisting
const { displayOrder, ui } = await import('../src/printshop.js');

describe('XSS Patch Verification', () => {
    beforeAll(() => {
        // Set up the DOM elements expected by the module
        document.body.innerHTML = `<!DOCTYPE html><html><body><div id="orders-list"></div></body></html>`;
        ui.ordersList = document.getElementById('orders-list');
    });

    test('should render malicious input as text, not HTML', () => {
        const maliciousPayload = `<img src=x onerror="document.body.setAttribute('data-xss', 'true')">`;
        const order = {
            orderId: 'test-xss-order',
            status: 'NEW',
            amount: 1000,
            billingContact: {
                givenName: 'Test',
                familyName: maliciousPayload,
            },
            receivedAt: new Date().toISOString(),
        };

        // Run the real function from src/printshop.js
        // Bolt update: displayOrder now returns the card, it does not append it automatically.
        // And now it returns a STRING, not an element.
        const cardHtml = displayOrder(order);
        ui.ordersList.innerHTML = cardHtml;

        const orderCard = document.querySelector('#order-card-test-xss-order');

        // 1. Check that no img tag was created from the payload
        // Note: The real displayOrder logic might structure things differently than the mock in the old test,
        // but the goal is the same: prevent XSS.
        const maliciousImg = orderCard.querySelector('img[src="x"]');
        expect(maliciousImg).toBeNull();

        // 2. Check that the payload is present as plain text
        // Find where the billing name is rendered.
        // Based on src/printshop.js:
        // billingDiv.append(...createDtDd('Billing Name:', `${order.billingContact?.givenName || ''} ${order.billingContact?.familyName || ''}`));
        // It creates dt and dd.

        // Let's find all DDs and check their text
        const dds = Array.from(orderCard.querySelectorAll('dd'));
        const nameDd = dds.find(dd => dd.textContent.includes(maliciousPayload));

        expect(nameDd).not.toBeUndefined();
        expect(nameDd.innerHTML).not.toContain('<img');

        // 3. Check that the data-xss attribute was NOT set on the body
        const xssAttribute = document.body.getAttribute('data-xss');
        expect(xssAttribute).toBeNull();
    });
});
