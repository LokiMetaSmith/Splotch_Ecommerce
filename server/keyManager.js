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
        if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY) {
            console.log('[KEY_MANAGER] Loading keys from environment variables.');
            const kid = 'env_key';
            const privateKey = process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
            const publicKey = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
            activeKeys.push({ kid, privateKey, publicKey, createdAt: Date.now() });
        } else {
            console.log('[KEY_MANAGER] No environment keys found, generating new key pair.');
            activeKeys.push(generateKeyPair());
        }
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
    try {
        const keys = await Promise.all(
            activeKeys.map(async (key) => {
                const jwk = await exportJWK(key.publicKey);
                return { ...jwk, kid: key.kid, use: 'sig', alg: 'RS256' };
            })
        );
        return { keys };
    } catch (error) {
        console.error('❌ [KEY_MANAGER] Error generating JWKS:', error);
        // Return an empty JWKS document in case of an error
        return { keys: [] };
    }
};

// Initial key generation
rotateKeys();
// Set up automatic rotation - This will be handled by the main server entry point
 setInterval(rotateKeys, KEY_LIFETIME_MS);
