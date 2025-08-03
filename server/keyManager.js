// keyManager.js
import crypto from 'crypto';
import { exportJWK } from 'jose';

let activeKeys = [];
const KEY_LIFETIME_MS = 60 * 60 * 1000; // Rotate keys every hour

// Generate a new RSA key pair
const generateKeyPair = () => {
    const kid = crypto.randomBytes(8).toString('hex');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { kid, privateKey, publicKey, createdAt: Date.now() };
};

// Get the current key for signing (always the newest one)
export const getCurrentSigningKey = () => {
    if (activeKeys.length === 0) {
        activeKeys.push(generateKeyPair());
    }
    return activeKeys[activeKeys.length - 1];
};

// Rotate keys: Add a new one and remove expired ones
export const rotateKeys = () => {
    console.log('[KEY_MANAGER] Rotating keys...');
    const now = Date.now();
    // Add a new key
    activeKeys.push(generateKeyPair());
    // Filter out old keys (older than 1 hour)
    activeKeys = activeKeys.filter(key => now - key.createdAt < KEY_LIFETIME_MS);
    console.log(`[KEY_MANAGER] Now managing ${activeKeys.length} active keys.`);
};

// Generate the public JWKS document
export const getJwks = async () => {
    const keys = await Promise.all(
        activeKeys.map(async (key) => {
            const jwk = await exportJWK(key.publicKey);
            return { ...jwk, kid: key.kid, use: 'sig', alg: 'RS256' };
        })
    );
    return { keys };
};

// Initial key generation
rotateKeys();
// Set up automatic rotation
setInterval(rotateKeys, KEY_LIFETIME_MS);
