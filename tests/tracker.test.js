import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Mock the module BEFORE importing the system under test
// For ESM default exports, we often need to return an object with a default property.
const mockEasyPostInstance = {
    Tracker: {
        create: jest.fn()
    }
};

const mockEasyPostConstructor = jest.fn(() => mockEasyPostInstance);

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The server resolves @easypost/api to the one in server/node_modules
// We must mock that specific file for the mock to take effect when imported from server/tracker.js
const easyPostServerPath = path.resolve(__dirname, '../server/node_modules/@easypost/api/dist/easypost.mjs');

jest.unstable_mockModule(easyPostServerPath, () => ({
    default: mockEasyPostConstructor,
}));

// Also mock the package name for completeness, in case module resolution changes
jest.unstable_mockModule('@easypost/api', () => ({
    default: mockEasyPostConstructor,
}));

jest.unstable_mockModule('../server/logger.js', () => ({
    default: mockLogger,
}));

// 2. Import the system under test AFTER mocking
// We use dynamic import to ensure the mock is in place before the module code runs
// (although in this case, the module initializes lazily, so static import might work,
// but unstable_mockModule + dynamic import is the robust ESM pattern).
const { initializeTracker, updateTrackingData, stopTracker } = await import('../server/tracker.js');

describe('Shipment Tracker', () => {
    let mockDb;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Mock DB structure
        mockDb = {
            data: {
                orders: {}
            },
            shippedOrders: [],
            write: jest.fn().mockResolvedValue(true)
        };

        // Reset Env
        delete process.env.EASYPOST_API_KEY;
        stopTracker();
    });

    afterAll(() => {
        stopTracker();
    });

    it('should not initialize if EASYPOST_API_KEY is missing', () => {
        initializeTracker(mockDb);
        expect(mockEasyPostConstructor).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('EASYPOST_API_KEY is not set'));
    });

    it('should initialize if EASYPOST_API_KEY is set', () => {
        process.env.EASYPOST_API_KEY = 'test_key';
        initializeTracker(mockDb);
        expect(mockEasyPostConstructor).toHaveBeenCalledWith('test_key');
    });

    it('should process shipped orders and update status to DELIVERED', async () => {
        process.env.EASYPOST_API_KEY = 'test_key';

        // Setup Order
        const orderId = 'order_1';
        const order = {
            orderId,
            status: 'SHIPPED',
            trackingNumber: 'TRACK123',
            courier: 'UPS'
        };
        mockDb.data.orders[orderId] = order;
        mockDb.shippedOrders.push(order);

        // Setup EasyPost Mock
        mockEasyPostInstance.Tracker.create.mockResolvedValue({
            status: 'delivered'
        });

        initializeTracker(mockDb);
        await updateTrackingData();

        expect(mockEasyPostInstance.Tracker.create).toHaveBeenCalledWith({
            tracking_code: 'TRACK123',
            carrier: 'UPS'
        });

        expect(order.status).toBe('DELIVERED');
        expect(mockDb.write).toHaveBeenCalled();
        expect(mockDb.shippedOrders).toHaveLength(0); // Should be removed from shipped cache
    });

    it('should not update status if tracker says not delivered', async () => {
        process.env.EASYPOST_API_KEY = 'test_key';

        const orderId = 'order_2';
        const order = {
            orderId,
            status: 'SHIPPED',
            trackingNumber: 'TRACK456',
            courier: 'USPS'
        };
        mockDb.data.orders[orderId] = order;
        mockDb.shippedOrders.push(order);

        mockEasyPostInstance.Tracker.create.mockResolvedValue({
            status: 'in_transit'
        });

        initializeTracker(mockDb);
        await updateTrackingData();

        expect(order.status).toBe('SHIPPED');
        expect(mockDb.write).not.toHaveBeenCalled();
        expect(mockDb.shippedOrders).toHaveLength(1);
    });

    it('should handle EasyPost errors gracefully', async () => {
        process.env.EASYPOST_API_KEY = 'test_key';

        const orderId = 'order_3';
        const order = {
            orderId,
            status: 'SHIPPED',
            trackingNumber: 'BADTRACK',
            courier: 'FedEx'
        };
        mockDb.data.orders[orderId] = order;
        mockDb.shippedOrders.push(order);

        mockEasyPostInstance.Tracker.create.mockRejectedValue(new Error('API Error'));

        initializeTracker(mockDb);
        await updateTrackingData();

        expect(order.status).toBe('SHIPPED');
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to track order'), expect.any(Error));
    });

    it('should use fallback if shippedOrders cache is missing', async () => {
        process.env.EASYPOST_API_KEY = 'test_key';

        const orderId = 'order_4';
        const order = {
            orderId,
            status: 'SHIPPED',
            trackingNumber: 'TRACK789',
            courier: 'DHL'
        };
        mockDb.data.orders[orderId] = order;
        // mockDb.shippedOrders is intentionally undefined
        delete mockDb.shippedOrders;

        mockEasyPostInstance.Tracker.create.mockResolvedValue({
            status: 'delivered'
        });

        initializeTracker(mockDb);
        await updateTrackingData();

        expect(mockEasyPostInstance.Tracker.create).toHaveBeenCalled();
        expect(order.status).toBe('DELIVERED');
        expect(mockDb.write).toHaveBeenCalled();
    });
});
