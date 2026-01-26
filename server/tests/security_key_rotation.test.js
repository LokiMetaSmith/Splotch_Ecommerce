import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import jwt from 'jsonwebtoken';

describe('Security: Key Rotation', () => {
    let keyManager;

    beforeAll(async () => {
        jest.useFakeTimers();
        // Import the module after setting fake timers
        keyManager = await import('../keyManager.js');
    });

    afterAll(() => {
        jest.useRealTimers();
        jest.resetModules();
    });

    it('should retain keys long enough to verify tokens signed just before rotation', async () => {
        // 1. Initial State: Key A exists
        // Since we removed the top-level call, we must ensure a key exists.
        // getCurrentSigningKey() generates one if empty.
        const keyA = keyManager.getCurrentSigningKey();
        expect(keyA).toBeDefined();
        const keyACreatedAt = keyA.createdAt;

        // 2. Advance time to T=50m
        const fiftyMinutes = 50 * 60 * 1000;
        jest.setSystemTime(keyACreatedAt + fiftyMinutes);

        // 3. Sign a token using Key A.
        // Token expires in 1 hour (expires at T=110m)
        const payload = { username: 'testuser' };
        const token = jwt.sign(payload, keyA.privateKey, {
            algorithm: 'RS256',
            expiresIn: '1h',
            header: { kid: keyA.kid }
        });

        // 4. Advance time to T=65m (Total from start).
        // This is 15 minutes after signing. Token is valid.
        // Key A age is 65 minutes.
        const fifteenMinutes = 15 * 60 * 1000;
        jest.setSystemTime(keyACreatedAt + fiftyMinutes + fifteenMinutes);

        // 5. Trigger Rotation
        // Rotation logic should now respect the retention period (2 hours)
        keyManager.rotateKeys();

        // 6. Verify Key A is STILL PRESENT
        const foundKeyA = keyManager.getKey(keyA.kid);

        // FIX ASSERTION: Key should be retained
        expect(foundKeyA).toBeDefined();
        expect(foundKeyA.kid).toEqual(keyA.kid);

        // 7. Verify token validation succeeds
        const decoded = jwt.decode(token, { complete: true });
        const keyToVerify = keyManager.getKey(decoded.header.kid);
        expect(keyToVerify).toBeDefined();

        const verified = jwt.verify(token, keyToVerify.publicKey);
        expect(verified.username).toEqual('testuser');
    });
});
