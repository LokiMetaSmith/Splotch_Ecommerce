import { jest } from '@jest/globals';
import * as jose from 'jose';
import {
  verifyAP2Mandate,
  verifyMandateBindings,
  computeCartDigest,
  computeShippingAddressHash
} from '../lib/ap2_crypto.js';

describe('AP2 Crypto Verification', () => {
    let keypair;
    let governanceKeypair;
    let untrustedKeypair;

    beforeAll(async () => {
        keypair = await jose.generateKeyPair('RS256');
        governanceKeypair = await jose.generateKeyPair('RS256');
        untrustedKeypair = await jose.generateKeyPair('RS256');
    });

    it('verifies a valid standard JWT with embedded JWK in development mode', async () => {
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

    it('rejects ephemeral self-signed JWK when allowEphemeralJWK is false', async () => {
        const jwk = await jose.exportJWK(untrustedKeypair.publicKey);
        const jwt = await new jose.SignJWT({ maxSpendCents: 1500 })
            .setProtectedHeader({ alg: 'RS256', jwk })
            .setIssuedAt()
            .setExpirationTime('2h')
            .sign(untrustedKeypair.privateKey);

        await expect(
            verifyAP2Mandate(jwt, { allowEphemeralJWK: false })
        ).rejects.toThrow('Ephemeral self-signed JWK rejected');
    });

    it('enforces governance key and rejects mandate signed by untrusted key claiming own JWK', async () => {
        // Attacker creates own keypair, signs mandate, embeds their own JWK in header
        const untrustedJwk = await jose.exportJWK(untrustedKeypair.publicKey);
        const maliciousJwt = await new jose.SignJWT({ maxSpendCents: 1500 })
            .setProtectedHeader({ alg: 'RS256', jwk: untrustedJwk })
            .setIssuedAt()
            .setExpirationTime('2h')
            .sign(untrustedKeypair.privateKey);

        // When verifying against the authorized governance public key
        await expect(
            verifyAP2Mandate(maliciousJwt, { publicKey: governanceKeypair.publicKey })
        ).rejects.toThrow();
    });

    describe('Mandate Cryptographic Bindings (Cart Digest & Shipping Destination)', () => {
        const sampleQuote = {
            quoteId: 'quo_123',
            total: 25.50,
            currency: 'USD'
        };

        const sampleShipping = {
            recipient_name: 'Alice',
            street_address: '123 Main St',
            city: 'Oklahoma City',
            state: 'OK',
            postal_code: '73159',
            country: 'US'
        };

        it('successfully validates when cart digest and shipping address hash match', () => {
            const cartDigest = computeCartDigest(sampleQuote);
            const shippingHash = computeShippingAddressHash(sampleShipping);

            const mandatePayload = {
                quoteId: 'quo_123',
                cart_digest: cartDigest,
                shipping_address_hash: shippingHash
            };

            expect(() => {
                verifyMandateBindings(mandatePayload, sampleQuote, sampleShipping);
            }).not.toThrow();
        });

        it('rejects when quote ID in mandate does not match the purchased quote', () => {
            const mandatePayload = {
                quoteId: 'quo_different',
                cart_digest: computeCartDigest(sampleQuote)
            };

            expect(() => {
                verifyMandateBindings(mandatePayload, sampleQuote, sampleShipping);
            }).toThrow('Mandate quote ID binding mismatch');
        });

        it('rejects when cart digest does not match (tampered item price/spec)', () => {
            const mandatePayload = {
                quoteId: 'quo_123',
                cart_digest: 'tampered_cart_digest'
            };

            expect(() => {
                verifyMandateBindings(mandatePayload, sampleQuote, sampleShipping);
            }).toThrow('Mandate cart digest mismatch');
        });

        it('rejects when destination address has been tampered with', () => {
            const originalShippingHash = computeShippingAddressHash(sampleShipping);

            const tamperedShipping = {
                ...sampleShipping,
                street_address: '999 Attacker Way'
            };

            const mandatePayload = {
                quoteId: 'quo_123',
                shipping_address_hash: originalShippingHash
            };

            expect(() => {
                verifyMandateBindings(mandatePayload, sampleQuote, tamperedShipping);
            }).toThrow('Shipping address hash mismatch: recipient destination differs');
        });
    });
});
