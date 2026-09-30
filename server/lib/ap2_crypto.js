import * as jose from 'jose';
import crypto from 'crypto';

/**
 * Computes a deterministic SHA-256 hash of a normalized shipping destination.
 * @param {object} shippingAddress
 * @returns {string|null} Hex encoded SHA-256 hash or null if empty
 */
export function computeShippingAddressHash(shippingAddress) {
  if (!shippingAddress || typeof shippingAddress !== 'object') return null;
  const normalized = {
    name: (shippingAddress.recipient_name || shippingAddress.name || '').trim().toLowerCase(),
    street: (shippingAddress.street_address || shippingAddress.street || shippingAddress.address1 || '').trim().toLowerCase(),
    city: (shippingAddress.city || '').trim().toLowerCase(),
    state: (shippingAddress.state || shippingAddress.province || '').trim().toLowerCase(),
    postal_code: (shippingAddress.postal_code || shippingAddress.zip || '').trim().toLowerCase(),
    country: (shippingAddress.country || 'US').trim().toUpperCase()
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Computes a deterministic canonical digest for a quote.
 * @param {object} quote
 * @returns {string} Hex encoded SHA-256 digest
 */
export function computeCartDigest(quote) {
  const quoteId = quote.quoteId || quote.quote_id || '';
  const total = parseFloat(quote.total || 0).toFixed(2);
  const currency = (quote.currency || 'USD').toUpperCase();
  return crypto.createHash('sha256').update(`${quoteId}:${total}:${currency}`).digest('hex');
}

/**
 * Parses and verifies an AP2 SD-JWT or standard JWT.
 * Enforces key authority hierarchy:
 *  1. Explicit options.publicKey
 *  2. Configured AP2_GOVERNANCE_PUBKEY
 *  3. Whitelisted key IDs / trusted keys
 *  4. Ephemeral header.jwk (strictly blocked in production unless allowEphemeralJWK: true)
 *
 * @param {string} token - The JWT or SD-JWT string.
 * @param {object} options - Options for verification.
 * @returns {Promise<object>} The verified payload.
 */
export async function verifyAP2Mandate(token, options = {}) {
  if (!token || typeof token !== 'string') {
    throw new Error('Mandate token must be a non-empty string');
  }

  // SD-JWTs consist of the base JWT, followed by disclosures separated by '~'
  const parts = token.split('~');
  const baseJwt = parts[0];

  const header = jose.decodeProtectedHeader(baseJwt);
  let publicKey;

  // 1. Explicit public key provided in call options
  if (options.publicKey) {
    if (typeof options.publicKey === 'string') {
      publicKey = await jose.importSPKI(options.publicKey, header.alg || 'RS256');
    } else {
      publicKey = options.publicKey;
    }
  }
  // 2. Configured Governance Authority Key (takes precedence over unverified header.jwk)
  else if (process.env.AP2_GOVERNANCE_PUBKEY || process.env.JWT_PUBLIC_KEY) {
    let govKey = process.env.AP2_GOVERNANCE_PUBKEY;
    if (!govKey || govKey.startsWith("${") || govKey.includes("your-ap2-governance")) {
      govKey = process.env.JWT_PUBLIC_KEY;
    }
    const isPlaceholder = !govKey || govKey === 'your-ap2-governance-public-key' || govKey === 'configured-on-request' || govKey.startsWith("${");
    if (isPlaceholder) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('AP2 Governance public key cannot use a default placeholder or unexpanded variable in production.');
      }
    } else {
      publicKey = await jose.importSPKI(govKey, header.alg || 'RS256');
    }
  }
  // 3. Header JWK handling with trust verification
  else if (header.jwk) {
    // If trusted key IDs are configured, enforce whitelist
    const trustedKids = (process.env.AP2_TRUSTED_KIDS || options.trustedKids || '')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    if (trustedKids.length > 0 && (!header.kid || !trustedKids.includes(header.kid))) {
      throw new Error(`Untrusted mandate key ID: kid '${header.kid}' is not in the authorized key list`);
    }

    // In production, block arbitrary ephemeral JWKs unless explicitly permitted
    const allowEphemeral = options.allowEphemeralJWK ?? (process.env.AP2_ALLOW_EPHEMERAL_JWK === 'true' || process.env.NODE_ENV !== 'production');
    if (!allowEphemeral) {
      throw new Error('Ephemeral self-signed JWK rejected in production. Mandate must be signed by an authorized governance key.');
    }

    publicKey = await jose.importJWK(header.jwk, header.alg);
  } else {
    throw new Error('No public key available to verify mandate.');
  }

  const { payload } = await jose.jwtVerify(baseJwt, publicKey, {
    audience: options.audience,
    issuer: options.issuer,
  });

  return payload;
}

/**
 * Validates cryptographic bindings between an AP2 Mandate and the cart / quote / shipping address.
 * @param {object} mandatePayload - Verified JWT payload
 * @param {object} quote - Stored quote record
 * @param {object} shippingAddress - Submitted shipping address
 */
export function verifyMandateBindings(mandatePayload, quote, shippingAddress) {
  if (!mandatePayload || !quote) return;

  // Verify Quote ID binding if present in mandate
  const boundQuoteId = mandatePayload.quoteId || mandatePayload.quote_id || mandatePayload.cart_binding?.quote_id;
  const targetQuoteId = quote.quoteId || quote.quote_id;
  if (boundQuoteId && boundQuoteId !== targetQuoteId) {
    throw new Error(`Mandate quote ID binding mismatch: bound to ${boundQuoteId}, order is for ${targetQuoteId}`);
  }

  // Verify Cart Digest binding if present in mandate
  const mandateDigest = mandatePayload.cart_digest || mandatePayload.cart_binding?.digest || mandatePayload.cart_binding?.cart_digest;
  if (mandateDigest) {
    const canonicalDigest = computeCartDigest(quote);
    const legacyDigest = quote.digest_sha256 || Buffer.from(`${quote.quoteId}:${quote.total}`).toString("hex");
    if (mandateDigest !== canonicalDigest && mandateDigest !== legacyDigest) {
      throw new Error('Mandate cart digest mismatch: items or pricing have been altered since mandate signing');
    }
  }

  // Verify Shipping Address Hash if present in mandate
  const mandateShippingHash = mandatePayload.shipping_address_hash || mandatePayload.cart_binding?.shipping_address_hash || mandatePayload.cart_binding?.shipping_hash;
  if (mandateShippingHash && shippingAddress) {
    const expectedShippingHash = computeShippingAddressHash(shippingAddress);
    if (mandateShippingHash !== expectedShippingHash) {
      throw new Error('Shipping address hash mismatch: recipient destination differs from authorized mandate');
    }
  }
}
