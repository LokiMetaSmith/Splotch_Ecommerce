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

const PROTOTYPE_POLLUTION_PATTERNS = [
    /(__proto__)/i,
];

// Combine patterns for faster initial check
const SQL_COMBINED = new RegExp(SQL_INJECTION_PATTERNS.map(p => p.source).join('|'), 'i');
const XSS_COMBINED = new RegExp(XSS_PATTERNS.map(p => p.source).join('|'), 'is');
const PATH_TRAVERSAL_COMBINED = new RegExp(PATH_TRAVERSAL_PATTERNS.map(p => p.source).join('|'), 'i');
const PROTO_POLLUTION_COMBINED = new RegExp(PROTOTYPE_POLLUTION_PATTERNS.map(p => p.source).join('|'), 'i');

// Optimize: Check ALL string threats in one go for the happy path (safe strings)
// 'is' flag: Ignore case + Dot matches newline (superset of individual flags)
const THREAT_COMBINED = new RegExp([
    SQL_COMBINED.source,
    XSS_COMBINED.source,
    PATH_TRAVERSAL_COMBINED.source,
    PROTO_POLLUTION_COMBINED.source
].join('|'), 'is');

const MAX_DEPTH = 20;

// Recursive function to check for threats in object/array/string
function checkPayload(payload, depth = 0) {
    if (!payload) return null;

    if (depth > MAX_DEPTH) {
        return { type: 'Deeply Nested Payload', pattern: 'Depth Limit Exceeded', path: [], value: 'Too Deep' };
    }

    if (typeof payload === 'string') {
        // Optimization: Fast path using combined regex
        // If the payload does not match ANY threat pattern, return immediately.
        // This saves ~66% of regex operations for benign traffic.
        if (!THREAT_COMBINED.test(payload)) {
             return null;
        }

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
            const result = checkPayload(payload[i], depth + 1);
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
                // Check for Prototype Pollution
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                    return { type: 'Prototype Pollution', pattern: key, path: [key] };
                }

                // Check for NoSQL Injection (keys starting with $)
                if (key.startsWith('$')) {
                    return { type: 'NoSQL Injection', pattern: key, path: [key] };
                }

                const result = checkPayload(payload[key], depth + 1);
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
    let threat;

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
    threat = checkPayload(req.query);
    if (threat) return blockRequest(req, res, processThreat(threat, 'query'));

    // Check Body
    threat = checkPayload(req.body);
    if (threat) return blockRequest(req, res, processThreat(threat, 'body'));

    // Check URL (Path + Query)
    // We decode the url to catch encoded attacks (e.g. %20OR%20)
    try {
        const decodedUrl = decodeURIComponent(req.url);

        // Check for Prototype Pollution in URL
        if (PROTO_POLLUTION_COMBINED.test(decodedUrl)) {
            for (const pattern of PROTOTYPE_POLLUTION_PATTERNS) {
                if (pattern.test(decodedUrl)) {
                    threat = { type: 'Prototype Pollution', pattern: pattern.toString(), path: [], value: decodedUrl };
                    break;
                }
            }
        }

        if (!threat) threat = checkPayload(decodedUrl);
        if (threat) return blockRequest(req, res, processThreat(threat, 'url'));
    } catch (e) {
        // If decoding fails, it might be a malformed URL, which is suspicious but we can ignore or block.
        // For now, check raw url just in case.
        if (PROTO_POLLUTION_COMBINED.test(req.url)) {
            for (const pattern of PROTOTYPE_POLLUTION_PATTERNS) {
                if (pattern.test(req.url)) {
                    threat = { type: 'Prototype Pollution', pattern: pattern.toString(), path: [], value: req.url };
                    break;
                }
            }
        }
        if (!threat) threat = checkPayload(req.url);
        if (threat) return blockRequest(req, res, processThreat(threat, 'url'));
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
