import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Secret Manager
 *
 * Abstraction layer for retrieving secrets.
 * Currently falls back to process.env, but allows for future integration
 * with external secret providers (e.g., Vault, Doppler, AWS Secrets Manager).
 */

const providers = {
    ENV: 'env'
};

const currentProvider = process.env.SECRET_PROVIDER || providers.ENV;

export function getSecret(key, defaultValue) {
    if (currentProvider === providers.ENV) {
        return process.env[key] !== undefined ? process.env[key] : defaultValue;
    }

    // Future providers implementation
    // if (currentProvider === 'vault') { ... }

    return defaultValue;
}
