// keyManager.js
import crypto from 'crypto';
import { exportJWK } from 'jose';
import { getSecret } from './secretManager.js';
import logger from './logger.js';

let activeKeys = [];
// Retention period must exceed token lifetime (1h) + rotation buffer.
// 2 hours provides ample overlap to ensure tokens are verifiable until they expire.
const KEY_RETENTION_MS = 2 * 60 * 60 * 1000;

export const KEY_ROTATION_MS = 60 * 60 * 1000; // Rotate keys every hour

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
        const jwtPrivateKey = getSecret('JWT_PRIVATE_KEY');
        const jwtPublicKey = getSecret('JWT_PUBLIC_KEY');

        if (jwtPrivateKey && jwtPublicKey) {
            logger.info('[KEY_MANAGER] Loading keys from environment variables.');
            const kid = 'env_key';
            const privateKey = jwtPrivateKey.replace(/\\n/g, '\n');
            const publicKey = jwtPublicKey.replace(/\\n/g, '\n');
            activeKeys.push({ kid, privateKey, publicKey, createdAt: Date.now() });
        } else {
            logger.info('[KEY_MANAGER] No environment keys found, generating new key pair.');
            activeKeys.push(generateKeyPair());
        }
    }
    return activeKeys[activeKeys.length - 1];
};

// Get a key by its ID
export const getKey = (kid) => {
    return activeKeys.find(key => key.kid === kid);
};

// Rotate keys: Add a new one and remove expired ones
export const rotateKeys = () => {
    logger.info('[KEY_MANAGER] Rotating keys...');
    const now = Date.now();
    // Add a new key
    activeKeys.push(generateKeyPair());
    // Filter out old keys (older than retention period)
    activeKeys = activeKeys.filter(key => now - key.createdAt < KEY_RETENTION_MS);
    logger.info(`[KEY_MANAGER] Now managing ${activeKeys.length} active keys.`);
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
        logger.error('❌ [KEY_MANAGER] Error generating JWKS:', error);
        // Return an empty JWKS document in case of an error
        return { keys: [] };
    }
};

// Note: Automatic rotation is handled by the main server entry point (server.js)
