import { jest } from '@jest/globals';

const mockMethodCall = jest.fn();
const mockCreateClient = jest.fn(() => ({
    methodCall: mockMethodCall
}));

// Mock xmlrpc before importing OdooClient
jest.unstable_mockModule('xmlrpc', () => ({
    default: {
        createClient: mockCreateClient,
        createSecureClient: mockCreateClient
    }
}));

// Dynamically import OdooClient after mocking
const { default: OdooClient } = await import('../odoo.js');

describe('OdooClient Configuration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default mock implementation
        mockMethodCall.mockImplementation((method, args, callback) => {
             // callback(error, result)
             callback(null, []);
        });
    });

    test('should use default hardcoded location IDs when defaults are not provided', async () => {
        const odoo = new OdooClient({
            url: 'http://localhost:8069',
            db: 'testdb',
            username: 'user',
            password: 'password'
        });

        mockMethodCall.mockImplementation((method, args, callback) => {
             if (method === 'authenticate') {
                 callback(null, 123);
             } else if (method === 'execute_kw') {
                 const model = args[3];
                 const operation = args[4];

                 if (model === 'stock.picking.type' && operation === 'read') {
                     // Return empty defaults so hardcoded ones are used
                     callback(null, []);
                 } else if (model === 'stock.picking' && operation === 'create') {
                     callback(null, 999);
                 } else {
                     callback(null, []);
                 }
             } else {
                 callback(null, []);
             }
        });

        await odoo.createStockPicking(1, [{ product_id: 10, qty: 1 }]);

        // Find the call to 'create' on 'stock.picking'
        // args structure for execute_kw: [db, uid, password, model, method, args_array, kwargs]
        const createCall = mockMethodCall.mock.calls.find(call =>
            call[0] === 'execute_kw' && call[1][3] === 'stock.picking' && call[1][4] === 'create'
        );
        expect(createCall).toBeDefined();

        const createArgs = createCall[1][5][0]; // First element of the arguments array passed to 'create'
        expect(createArgs.location_id).toBe(8);
        expect(createArgs.location_dest_id).toBe(5);
    });

    test('should use configured location IDs when provided in defaults', async () => {
        const odoo = new OdooClient({
            url: 'http://localhost:8069',
            db: 'testdb',
            username: 'user',
            password: 'password',
            defaults: {
                location_id: 123,
                location_dest_id: 456
            }
        });

        mockMethodCall.mockImplementation((method, args, callback) => {
             if (method === 'authenticate') {
                 callback(null, 123);
             } else if (method === 'execute_kw') {
                 const model = args[3];
                 const operation = args[4];

                 if (model === 'stock.picking.type' && operation === 'read') {
                     callback(null, []);
                 } else if (model === 'stock.picking' && operation === 'create') {
                     callback(null, 999);
                 } else {
                     callback(null, []);
                 }
             } else {
                 callback(null, []);
             }
        });

        await odoo.createStockPicking(1, [{ product_id: 10, qty: 1 }]);

        const createCall = mockMethodCall.mock.calls.find(call =>
            call[0] === 'execute_kw' && call[1][3] === 'stock.picking' && call[1][4] === 'create'
        );
        expect(createCall).toBeDefined();

        const createArgs = createCall[1][5][0];
        expect(createArgs.location_id).toBe(123);
        expect(createArgs.location_dest_id).toBe(456);
    });
});
