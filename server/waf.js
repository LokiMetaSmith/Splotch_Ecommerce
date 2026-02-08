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

// Combine patterns for faster initial check
const SQL_COMBINED = new RegExp(SQL_INJECTION_PATTERNS.map(p => p.source).join('|'), 'i');
const XSS_COMBINED = new RegExp(XSS_PATTERNS.map(p => p.source).join('|'), 'is');
const PATH_TRAVERSAL_COMBINED = new RegExp(PATH_TRAVERSAL_PATTERNS.map(p => p.source).join('|'), 'i');

// Recursive function to check for threats in object/array/string
function checkPayload(payload) {
    if (!payload) return null;

    if (typeof payload === 'string') {
        // Check string against combined patterns first (Fast Path)

        if (SQL_COMBINED.test(payload)) {
            // Confirm which pattern matched (Slow Path)
            for (const pattern of SQL_INJECTION_PATTERNS) {
                if (pattern.test(payload)) return { type: 'SQL Injection', pattern: pattern.toString(), path: [], value: payload };
            }
        }

        if (XSS_COMBINED.test(payload)) {
            for (const pattern of XSS_PATTERNS) {
                if (pattern.test(payload)) return { type: 'XSS', pattern: pattern.toString(), path: [], value: payload };
            }
        }

        // Only check path traversal on strings that look like paths? No, check all.
        // But legit text might contain ".." (e.g. "Wait..").
        // The pattern is `../` or `..%2F`, so "Wait.." is safe.
        if (PATH_TRAVERSAL_COMBINED.test(payload)) {
            for (const pattern of PATH_TRAVERSAL_PATTERNS) {
                if (pattern.test(payload)) return { type: 'Path Traversal', pattern: pattern.toString(), path: [], value: payload };
            }
        }
        return null;
    }

    if (Array.isArray(payload)) {
        for (let i = 0; i < payload.length; i++) {
            const result = checkPayload(payload[i]);
            if (result) {
                result.path.unshift(`[${i}]`);
                return result;
            }
        }
        return null;
    }

    if (typeof payload === 'object') {
        for (const key in payload) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) {
                // Check for NoSQL Injection (keys starting with $)
                if (key.startsWith('$')) {
                    return { type: 'NoSQL Injection', pattern: key, path: [key] };
                }

                const result = checkPayload(payload[key]);
                if (result) {
                    result.path.unshift(key);
                    return result;
                }
            }
        }
        return null;
    }

    return null;
}

export function wafMiddleware(req, res, next) {
    // Combine all inputs to check
    // We check query, body, and params

    const processThreat = (threat, context) => {
        if (!threat) return null;
        // Join the path array into a readable string
        // We prepend the context (query/body/path) first
        threat.path.unshift(context);

        // Custom joiner: "query" + ".field" but "query" + "[0]"
        threat.path = threat.path.reduce((acc, curr, i) => {
            if (i === 0) return curr;
            return acc + (curr.startsWith('[') ? '' : '.') + curr;
        }, '');
        return threat;
    };

    // Check Query
    let threat = checkPayload(req.query);
    if (threat) return blockRequest(req, res, processThreat(threat, 'query'));

    // Check Body
    threat = checkPayload(req.body);
    if (threat) return blockRequest(req, res, processThreat(threat, 'body'));

    // Check URL Path (instead of params which are empty here)
    // We decode the path to catch encoded attacks (e.g. %20OR%20)
    try {
        const decodedPath = decodeURIComponent(req.path);
        threat = checkPayload(decodedPath);
        if (threat) return blockRequest(req, res, processThreat(threat, 'path'));
    } catch (e) {
        // If decoding fails, it might be a malformed URL, which is suspicious but we can ignore or block.
        // For now, check raw path just in case.
        threat = checkPayload(req.path);
        if (threat) return blockRequest(req, res, processThreat(threat, 'path'));
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
