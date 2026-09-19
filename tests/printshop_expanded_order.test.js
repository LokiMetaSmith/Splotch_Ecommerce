/** @jest-environment jsdom */
import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals';

// Mocks for browser/crypto libraries used in printshop.js
jest.unstable_mockModule('jose', () => ({}));
jest.unstable_mockModule('jspdf', () => ({ jsPDF: jest.fn() }));
jest.unstable_mockModule('svg2pdf.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('html5-qrcode', () => ({ Html5Qrcode: jest.fn() }));
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

const {
  getOrderSpecs,
  displayOrder,
  displayOrderRow,
  toggleOrderExpansion,
  expandedOrderIds,
  ui
} = await import('../src/printshop.js');

describe('Print Shop Expanded Order Specifications & List Expansion', () => {
  beforeAll(() => {
    document.body.innerHTML = '<!DOCTYPE html><html><body><div id="orders-list"></div></body></html>';
    ui.ordersList = document.getElementById('orders-list');
  });

  beforeEach(() => {
    expandedOrderIds.clear();
  });

  describe('getOrderSpecs helper', () => {
    test('extracts direct widthInches and heightInches', () => {
      const order = {
        orderId: 'test-direct-inches',
        orderDetails: {
          widthInches: 3.5,
          heightInches: 4.2,
          resolution: 'dpi_300',
          material: 'pp_standard',
          cutType: 'die_cut'
        }
      };
      const specs = getOrderSpecs(order);
      expect(specs.widthInches).toBe(3.5);
      expect(specs.heightInches).toBe(4.2);
      expect(specs.formattedWidth).toBe('3.5"');
      expect(specs.formattedHeight).toBe('4.2"');
      expect(specs.formattedSize).toBe('3.5" × 4.2"');
      expect(specs.areaSqIn).toBe(14.7);
      expect(specs.resolutionName).toContain('300 DPI');
      expect(specs.ppi).toBe(300);
      expect(specs.cutTypeName).toBe('Die Cut');
      expect(specs.materialName).toBe('Standard White Vinyl');
    });

    test('calculates inches from pixel dimensions and resolution PPI', () => {
      const order = {
        orderId: 'test-pixel-dimensions',
        orderDetails: {
          dimensions: { width: 900, height: 1200 },
          resolution: 'dpi_300'
        }
      };
      const specs = getOrderSpecs(order);
      expect(specs.widthInches).toBe(3);
      expect(specs.heightInches).toBe(4);
      expect(specs.formattedWidth).toBe('3"');
      expect(specs.formattedHeight).toBe('4"');
      expect(specs.formattedSize).toBe('3" × 4"');
      expect(specs.areaSqIn).toBe(12);
    });

    test('parses dimensions from size string if width/height not directly present', () => {
      const order = {
        orderId: 'test-size-string',
        orderDetails: {
          size: '2.5" × 5.0"',
          resolution: 'dpi_600',
          cutType: 'kiss_cut'
        }
      };
      const specs = getOrderSpecs(order);
      expect(specs.widthInches).toBe(2.5);
      expect(specs.heightInches).toBe(5);
      expect(specs.formattedWidth).toBe('2.5"');
      expect(specs.formattedHeight).toBe('5"');
      expect(specs.resolutionName).toContain('600 DPI');
      expect(specs.ppi).toBe(600);
      expect(specs.cutTypeName).toBe('Kiss Cut');
    });

    test('handles missing or partial specs gracefully', () => {
      const order = {
        orderId: 'test-empty-specs',
        orderDetails: {}
      };
      const specs = getOrderSpecs(order);
      expect(specs.formattedWidth).toBe('N/A');
      expect(specs.formattedHeight).toBe('N/A');
      expect(specs.formattedSize).toBe('N/A');
      expect(specs.areaSqIn).toBeNull();
      expect(specs.resolutionName).toBe('300 DPI');
    });
  });

  describe('displayOrder (Card View)', () => {
    test('renders width, height, resolution, and dimensions in the card', () => {
      const order = {
        orderId: 'card-view-test-12345',
        status: 'NEW',
        amount: 2500,
        receivedAt: new Date().toISOString(),
        orderDetails: {
          widthInches: 4,
          heightInches: 6,
          resolution: 'dpi_300',
          quantity: 20,
          material: 'vinyl_gloss',
          cutType: 'die_cut'
        },
        billingContact: { givenName: 'John', familyName: 'Doe', email: 'john@example.com' },
        shippingContact: { givenName: 'John', familyName: 'Doe', email: 'john@example.com' }
      };

      const html = displayOrder(order);
      expect(html).toContain('Dimensions (W × H):');
      expect(html).toContain('4" × 6"');
      expect(html).toContain('Width:');
      expect(html).toContain('4"');
      expect(html).toContain('Height:');
      expect(html).toContain('6"');
      expect(html).toContain('Resolution:');
      expect(html).toContain('300 DPI');
      expect(html).toContain('Glossy Vinyl');
      expect(html).toContain('Die Cut');
    });
  });

  describe('displayOrderRow (List View)', () => {
    test('renders table row with expand toggle and hidden details row by default', () => {
      const order = {
        orderId: 'row-view-test-99999',
        status: 'ACCEPTED',
        amount: 3500,
        receivedAt: new Date().toISOString(),
        orderDetails: {
          widthInches: 2,
          heightInches: 3.5,
          resolution: 'dpi_300',
          quantity: 50,
          material: 'pp_standard',
          cutType: 'kiss_cut'
        },
        billingContact: { givenName: 'Jane', familyName: 'Smith', email: 'jane@example.com' },
        shippingContact: { givenName: 'Jane', familyName: 'Smith', email: 'jane@example.com' }
      };

      const html = displayOrderRow(order);
      expect(html).toContain('order-expand-toggle-btn');
      expect(html).toContain('order-expanded-row');
      expect(html).toContain('id="order-expanded-row-view-test-99999"');
      expect(html).toContain('hidden');
      expect(html).toContain('2"');
      expect(html).toContain('3.5"');
      expect(html).toContain('300 DPI');
      expect(html).toContain('Kiss Cut');
    });

    test('renders expanded detail row visible when order is in expandedOrderIds', () => {
      const orderId = 'row-view-expanded-order';
      expandedOrderIds.add(orderId);

      const order = {
        orderId: orderId,
        status: 'PRINTING',
        amount: 4500,
        receivedAt: new Date().toISOString(),
        orderDetails: {
          widthInches: 5,
          heightInches: 5,
          resolution: 'dpi_300',
          quantity: 100
        }
      };

      const html = displayOrderRow(order);
      expect(html).toContain('id="order-expanded-row-view-expanded-order"');
      // Verify that the expanded row does NOT contain the 'hidden' class
      const rowMatch = html.match(/<tr[^>]*id="order-expanded-row-view-expanded-order"[^>]*>/);
      expect(rowMatch).toBeTruthy();
      expect(rowMatch[0]).not.toContain('hidden');
    });
  });

  describe('toggleOrderExpansion interactivity', () => {
    test('toggles expandedOrderIds state and DOM classes', () => {
      const orderId = 'interactivity-test-order';
      const order = {
        orderId: orderId,
        status: 'NEW',
        amount: 1500,
        receivedAt: new Date().toISOString(),
        orderDetails: {
          widthInches: 3,
          heightInches: 3,
          resolution: 'dpi_300'
        }
      };

      document.body.innerHTML = `
        <table>
          <tbody>
            ${displayOrderRow(order)}
          </tbody>
        </table>
      `;

      const expandedRow = document.getElementById(`order-expanded-${orderId}`);
      expect(expandedRow.classList.contains('hidden')).toBe(true);
      expect(expandedOrderIds.has(orderId)).toBe(false);

      // Toggle Open
      toggleOrderExpansion(orderId);
      expect(expandedRow.classList.contains('hidden')).toBe(false);
      expect(expandedOrderIds.has(orderId)).toBe(true);

      // Toggle Closed
      toggleOrderExpansion(orderId);
      expect(expandedRow.classList.contains('hidden')).toBe(true);
      expect(expandedOrderIds.has(orderId)).toBe(false);
    });
  });
});
