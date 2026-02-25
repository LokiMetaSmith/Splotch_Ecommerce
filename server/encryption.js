import crypto from 'crypto';
import { getSecret } from './secretManager.js';
import logger from './logger.js';

const rawSecret = getSecret('JWT_SECRET');
let ENCRYPTION_KEY;

// Robust key derivation to prevent crashes and ensure 32-byte key length for AES-256
if (!rawSecret) {
    if (getSecret('ENCRYPT_CLIENT_JSON') === 'true') {
        logger.error('❌ [FATAL] JWT_SECRET is missing but ENCRYPT_CLIENT_JSON is true.');
        logger.error('   You must provide a JWT_SECRET to encrypt the database.');
        process.exit(1);
    }
    // If encryption is disabled, we set a dummy key to prevent crashes if the key is accessed inadvertently.
    // This key will not be used for encryption as the encrypt/decrypt functions are guarded by the flag.
    ENCRYPTION_KEY = crypto.createHash('sha256').update('unused-key-when-encryption-disabled').digest();
} else if (Buffer.byteLength(rawSecret) === 32) {
    // Backward compatibility: If exactly 32 bytes, use as-is (legacy behavior)
    ENCRYPTION_KEY = rawSecret;
} else {
    // Robustness: Hash arbitrary length secrets to exactly 32 bytes
    ENCRYPTION_KEY = crypto.createHash('sha256').update(String(rawSecret)).digest();
}

const IV_LENGTH = 16; // For AES, this is always 16

export function encrypt(text) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text) {
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
