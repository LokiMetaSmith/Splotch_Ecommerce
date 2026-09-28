import * as jose from 'jose';

/**
 * Parses and verifies an AP2 SD-JWT or standard JWT.
 * @param {string} token - The JWT or SD-JWT string.
 * @param {object} options - Options for verification (e.g., specific public key to enforce).
 * @returns {Promise<object>} The verified payload.
 */
export async function verifyAP2Mandate(token, options = {}) {
  // SD-JWTs consist of the base JWT, followed by disclosures separated by '~'
  const parts = token.split('~');
  const baseJwt = parts[0];

  const header = jose.decodeProtectedHeader(baseJwt);
  let publicKey;

  // Enforce specific key if provided, otherwise extract from JWK in header
  if (options.publicKey) {
    if (typeof options.publicKey === 'string') {
        publicKey = await jose.importSPKI(options.publicKey, header.alg || 'RS256');
    } else {
        publicKey = options.publicKey;
    }
  } else if (header.jwk) {
    publicKey = await jose.importJWK(header.jwk, header.alg);
  } else if (process.env.AP2_GOVERNANCE_PUBKEY) {
    publicKey = await jose.importSPKI(process.env.AP2_GOVERNANCE_PUBKEY, header.alg || 'RS256');
  } else {
    throw new Error('No public key available to verify mandate.');
  }

  const { payload } = await jose.jwtVerify(baseJwt, publicKey, {
    audience: options.audience,
    issuer: options.issuer,
  });

  return payload;
}
