import logger from './logger.js';

// Define attack patterns
// Using specific patterns to avoid false positives
// Note: We avoid blocking single quotes (') as they are common in names (e.g., O'Connor)
const SQL_INJECTION_PATTERNS = [
    /(\bUNION\s+SELECT\b)/i, // Union based
    /(\bDROP\s+TABLE\b)/i, // Drop table
    /(\bALTER\s+TABLE\b)/i, // Alter table
    /(\bEXEC\s+\()/i, // Exec
    /(\bOR\s+['"]?[\w]+['"]?\s*=\s*['"]?[\w]+['"]?)/i, // OR 1=1 type attacks
    /(\s--\s)/, // Comment style -- with spaces
    /(\/\*.*\*\/)/, // Block comments
    /(;\s*DROP\s+)/i, // Semicolon followed by DROP
    /(;\s*DELETE\s+)/i, // Semicolon followed by DELETE
];

const XSS_PATTERNS = [
    /(<script.*?>.*?<\/script>)/is, // Script tags (multiline)
    /(javascript:)/i, // Javascript protocol
    /(on\w+\s*=\s*(?:['"].*?['"]|[^>\s]+))/i, // Event handlers like onload=
    /(<iframe.*?>.*?<\/iframe>)/is, // Iframes
    /(<object.*?>.*?<\/object>)/is, // Objects
    /(<embed.*?>.*?<\/embed>)/is, // Embeds
];

const PATH_TRAVERSAL_PATTERNS = [
    /(\.\.\/)/, // ../
    /(\.\.%2F)/i, // ..%2F
];

// Recursive function to check for threats in object/array/string
function checkPayload(payload, path = '') {
    if (!payload) return null;

    if (typeof payload === 'string') {
        // Check string against patterns
        for (const pattern of SQL_INJECTION_PATTERNS) {
            if (pattern.test(payload)) return { type: 'SQL Injection', pattern: pattern.toString(), path, value: payload };
        }
        for (const pattern of XSS_PATTERNS) {
            if (pattern.test(payload)) return { type: 'XSS', pattern: pattern.toString(), path, value: payload };
        }
        // Only check path traversal on strings that look like paths? No, check all.
        // But legit text might contain ".." (e.g. "Wait..").
        // The pattern is `../` or `..%2F`, so "Wait.." is safe.
        for (const pattern of PATH_TRAVERSAL_PATTERNS) {
            if (pattern.test(payload)) return { type: 'Path Traversal', pattern: pattern.toString(), path, value: payload };
        }
        return null;
    }

    if (Array.isArray(payload)) {
        for (let i = 0; i < payload.length; i++) {
            const result = checkPayload(payload[i], `${path}[${i}]`);
            if (result) return result;
        }
        return null;
    }

    if (typeof payload === 'object') {
        for (const key in payload) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) {
                // Check for NoSQL Injection (keys starting with $)
                if (key.startsWith('$')) {
                    return { type: 'NoSQL Injection', pattern: key, path: `${path}.${key}` };
                }

                const result = checkPayload(payload[key], `${path}.${key}`);
                if (result) return result;
            }
        }
        return null;
    }

    return null;
}

export function wafMiddleware(req, res, next) {
    // Combine all inputs to check
    // We check query, body, and params

    // Check Query
    let threat = checkPayload(req.query, 'query');
    if (threat) return blockRequest(req, res, threat);

    // Check Body
    threat = checkPayload(req.body, 'body');
    if (threat) return blockRequest(req, res, threat);

    // Check URL Path (instead of params which are empty here)
    // We decode the path to catch encoded attacks (e.g. %20OR%20)
    try {
        const decodedPath = decodeURIComponent(req.path);
        threat = checkPayload(decodedPath, 'path');
        if (threat) return blockRequest(req, res, threat);
    } catch (e) {
        // If decoding fails, it might be a malformed URL, which is suspicious but we can ignore or block.
        // For now, check raw path just in case.
        threat = checkPayload(req.path, 'path');
        if (threat) return blockRequest(req, res, threat);
    }

    next();
}

function blockRequest(req, res, threat) {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    // Log the threat details, but truncate value if too long to avoid huge logs
    const safeValue = (threat.value && threat.value.length > 100) ? threat.value.substring(0, 100) + '...' : threat.value;

    logger.warn(`[SECURITY] WAF blocked suspicious request from IP ${clientIp}. Type: ${threat.type}. Path: ${threat.path}. Pattern: ${threat.pattern}. Value: ${safeValue}`);

    // Return 403 Forbidden
    return res.status(403).json({
        error: 'Forbidden',
        message: 'Your request was blocked by the security firewall due to suspicious content.'
    });
}
