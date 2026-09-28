import { jest } from '@jest/globals';
import * as jose from 'jose';
import { verifyAP2Mandate } from '../lib/ap2_crypto.js';

describe('AP2 Crypto Verification', () => {
    let keypair;

    beforeAll(async () => {
        keypair = await jose.generateKeyPair('RS256');
    });

    it('verifies a valid standard JWT with embedded JWK', async () => {
        const jwk = await jose.exportJWK(keypair.publicKey);
        const jwt = await new jose.SignJWT({ maxSpendCents: 1500 })
            .setProtectedHeader({ alg: 'RS256', jwk })
            .setIssuedAt()
            .setExpirationTime('2h')
            .sign(keypair.privateKey);

        const payload = await verifyAP2Mandate(jwt);
        expect(payload.maxSpendCents).toBe(1500);
    });

    it('verifies an SD-JWT format string (base JWT extraction)', async () => {
        const jwk = await jose.exportJWK(keypair.publicKey);
        const baseJwt = await new jose.SignJWT({ intentId: '123' })
            .setProtectedHeader({ alg: 'RS256', jwk })
            .setIssuedAt()
            .setExpirationTime('2h')
            .sign(keypair.privateKey);

        const sdJwt = `${baseJwt}~disclosure1~disclosure2~`;
        const payload = await verifyAP2Mandate(sdJwt);
        expect(payload.intentId).toBe('123');
    });

    it('fails if token is expired', async () => {
        const jwk = await jose.exportJWK(keypair.publicKey);
        const jwt = await new jose.SignJWT({ intentId: '123' })
            .setProtectedHeader({ alg: 'RS256', jwk })
            .setIssuedAt()
            .setExpirationTime('-1h') // expired
            .sign(keypair.privateKey);

        await expect(verifyAP2Mandate(jwt)).rejects.toThrow();
    });
});
