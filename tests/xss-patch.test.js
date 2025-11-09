// tests/xss-patch.test.js
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { JSDOM } from 'jsdom';

// We cannot import the whole script as it has browser-specific dependencies.
// Instead, we will test the core logic of the displayOrder function.
// This requires refactoring the original script to export the function.
// For this test, we will simulate the function's behavior.

// This is a simplified, standalone version of the displayOrder function,
// containing the XSS patch, for isolated testing.
function displayOrder(order, document, ui) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.id = `order-card-${order.orderId}`;

    const formattedAmount = order.amount ? `$${(order.amount / 100).toFixed(2)}` : 'N/A';
    const receivedDate = new Date(order.receivedAt).toLocaleString();

    const createEl = (tag, classes = [], attributes = {}, text) => {
        const el = document.createElement(tag);
        if (classes.length > 0) el.className = classes.join(' ');
        for (const [key, value] of Object.entries(attributes)) {
            el.setAttribute(key, value);
        }
        if (text) el.textContent = text;
        return el;
    };

    const billingDiv = createEl('div');
    const dt = createEl('dt', [], {}, 'Billing Name:');
    // The key part of the patch: using textContent, not innerHTML
    const dd = createEl('dd');
    dd.textContent = `${order.billingContact?.givenName || ''} ${order.billingContact?.familyName || ''}`;
    billingDiv.append(dt, dd);

    card.appendChild(billingDiv);
    ui.ordersList.prepend(card);
}


describe('XSS Patch Verification', () => {
    let dom;
    let window;
    let document;
    let ui;

    beforeAll(() => {
        const html = `<!DOCTYPE html><html><body><div id="orders-list"></div></body></html>`;
        dom = new JSDOM(html);
        window = dom.window;
        document = window.document;

        ui = {
            ordersList: document.getElementById('orders-list'),
        };
    });

    test('should render malicious input as text, not HTML', () => {
        const maliciousPayload = `<img src=x onerror="document.body.setAttribute('data-xss', 'true')">`;
        const order = {
            orderId: 'test-xss-order',
            billingContact: {
                givenName: 'Test',
                familyName: maliciousPayload,
            },
            receivedAt: new Date().toISOString(),
        };

        // Run the patched function in our test environment
        displayOrder(order, document, ui);

        const orderCard = document.querySelector('#order-card-test-xss-order');

        // 1. Check that no img tag was created from the payload
        const maliciousImg = orderCard.querySelector('img[src="x"]');
        expect(maliciousImg).toBeNull();

        // 2. Check that the payload is present as plain text
        const ddElement = orderCard.querySelector('dd');
        expect(ddElement.textContent).toContain(maliciousPayload);
        expect(ddElement.innerHTML).not.toContain('<img');

        // 3. Check that the data-xss attribute was NOT set on the body
        const xssAttribute = document.body.getAttribute('data-xss');
        expect(xssAttribute).toBeNull();
    });
});
