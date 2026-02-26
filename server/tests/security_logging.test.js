
import { describe, it, expect, jest, beforeAll } from '@jest/globals';

// Jest hoisting is tricky with ESM.
// We must use `unstable_mockModule` BEFORE any import.

describe('Security: PII Logging Leak', () => {
    let LowDbAdapterClass;
    let mockLogger;

    beforeAll(async () => {
        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        // Note: The path MUST match the import in the source file exactly if it's external,
        // or the relative path if internal.
        await jest.unstable_mockModule('../logger.js', () => ({
            default: mockLogger
        }));

        // Dynamic import to ensure the mock is used
        const module = await import('../database/lowdb_adapter.js');
        LowDbAdapterClass = module.LowDbAdapter;
    });

    it('should NOT log PII when migrating malformed orders', () => {
        const sensitiveEmail = 'victim@example.com';
        const sensitiveName = 'John Doe';

        const malformedOrder = {
            // Missing orderId
            amount: 1000,
            billingContact: {
                email: sensitiveEmail,
                givenName: sensitiveName
            }
        };

        const db = {
            data: {
                orders: [malformedOrder], // Array trigger migration
                users: {},
                products: {},
                credentials: {},
                config: {},
                emailIndex: {},
                inventory_cache: {}
            },
            write: jest.fn()
        };

        // Instantiate adapter which runs the migration logic in constructor
        new LowDbAdapterClass(db);

        // Check logger.warn calls
        expect(mockLogger.warn).toHaveBeenCalled();

        // Check for PII Leak
        const warnCalls = mockLogger.warn.mock.calls;
        let piiLeaked = false;

        for (const call of warnCalls) {
            // Logger args might be strings or objects.
            // Winston logger typically takes (message, meta) or formatted string.
            // Our mock receives them as arguments.
            const message = call.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');

            if (message.includes(sensitiveEmail) || message.includes(sensitiveName)) {
                piiLeaked = true;
            }
        }

        // To "Fail" the test if vulnerability exists (as per reproduction step),
        // we throw if piiLeaked is TRUE.
        // Wait, if I want to "reproduce" it, I should assert `expect(piiLeaked).toBe(true)` and see the test PASS?
        // No, standard practice: Test should Fail if vulnerability exists, then Pass after fix.
        // But the previous output showed `expect(mockLogger.warn).toHaveBeenCalled()` FAILED.
        // This implies the mock was NOT called, or the real logger was used.
        // The output showed real log output: "2026-02-26 ... warn: [LowDbAdapter] Found order ..."
        // This means the mock did not take effect for the internal call.

        if (piiLeaked) {
             throw new Error('PII Leaked in logs!');
        }
    });
});
