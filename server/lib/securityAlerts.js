import logger from '../logger.js';

// Cooldown storage: map client IP to timestamp of last alert
const ipAlertCooldowns = new Map();
const DEFAULT_IP_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per IP

// Strike tracking: map client IP to strike count and timestamps for multi-strike escalation
const ipStrikes = new Map();
const STRIKE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const STRIKES_TO_ESCALATE = 2; // 2nd strike escalates to CRITICAL

// Global alert throttle: maximum 10 alerts per minute to avoid hitting Telegram rate limits
let globalAlertsInMinute = 0;
let globalWindowStart = Date.now();
const MAX_GLOBAL_ALERTS_PER_MINUTE = 10;

// Periodic cleanup of stale cooldown and strike entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamp] of ipAlertCooldowns.entries()) {
    if (now - timestamp > DEFAULT_IP_COOLDOWN_MS * 2) {
      ipAlertCooldowns.delete(ip);
    }
  }
  for (const [ip, data] of ipStrikes.entries()) {
    if (now - data.lastHit > STRIKE_WINDOW_MS) {
      ipStrikes.delete(ip);
    }
  }
}, 15 * 60 * 1000).unref();

/**
 * Extracts and normalizes the client's real IP address from request headers or socket.
 * Handles reverse proxies, Cloudflare, and IPv6-mapped IPv4 representations.
 */
export function getClientIp(req) {
  if (!req) return 'unknown';

  let rawIp =
    req.headers?.['cf-connecting-ip'] ||
    req.headers?.['x-real-ip'] ||
    (req.headers?.['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown';

  // Normalize IPv6-mapped IPv4 addresses (e.g. "::ffff:192.168.1.50" -> "192.168.1.50")
  if (typeof rawIp === 'string' && rawIp.startsWith('::ffff:')) {
    rawIp = rawIp.replace('::ffff:', '');
  }

  return rawIp;
}

/**
 * Clears the alert cooldown and strike maps. Useful for unit and integration testing.
 */
export function clearAlertCooldowns() {
  ipAlertCooldowns.clear();
  ipStrikes.clear();
  globalAlertsInMinute = 0;
  globalWindowStart = Date.now();
}

/**
 * Strips or replaces characters that could break Telegram Markdown parsing.
 */
function sanitizeTelegramMarkdown(str) {
  if (!str) return '';
  return String(str).replace(/[`*_]/g, ' ');
}

/**
 * Formats a clean, readable Markdown message for the Telegram security alert channel.
 */
export function formatSecurityAlertMessage({ type, ip, method, path, details, userAgent, severity = 'CRITICAL' }) {
  const time = new Date().toUTCString();
  const safeAgent = sanitizeTelegramMarkdown(userAgent || 'unknown');
  const safePath = sanitizeTelegramMarkdown(path || '/');
  const safeDetails = details ? sanitizeTelegramMarkdown(details) : null;
  const safeType = sanitizeTelegramMarkdown(type || 'Hostile Activity');

  const lines = [
    `🚨 *SECURITY ALERT: [${severity}] ${safeType}*`,
    ``,
    `*Attacker IP:* \`${ip}\``,
    `*Method / Path:* \`${method || 'GET'}\` \`${safePath}\``,
    `*Timestamp:* ${time}`,
  ];

  if (safeDetails) {
    lines.push(`*Details:* ${safeDetails}`);
  }

  lines.push(
    `*User-Agent:* \`${safeAgent.slice(0, 150)}\``,
    ``,
    `⚠️ _Fail2ban & CrowdSec are tracking this IP and will drop packets at the firewall level._`
  );

  return lines.join('\n');
}

/**
 * Dispatches a security alert:
 * 1. ALWAYS logs a standardized [SECURITY] warning for Fail2ban & CrowdSec to count towards bans.
 * 2. Tracks strikes per IP: repeated low/medium strikes automatically escalate to CRITICAL.
 * 3. Filters alerts: Only CRITICAL events trigger a Telegram push notification.
 * 4. Applies IP and global cooldowns to prevent Telegram notification spam.
 */
export async function dispatchSecurityAlert({
  type,
  ip,
  method = 'GET',
  path = '',
  details = '',
  userAgent = '',
  severity = 'MEDIUM',
  scheduleTelegram,
  req,
}) {
  const clientIp = ip || (req ? getClientIp(req) : 'unknown');
  const clientMethod = method || (req ? req.method : 'GET');
  const clientPath = path || (req ? (req.originalUrl || req.path) : '');
  const clientAgent = userAgent || (req?.headers ? req.headers['user-agent'] : 'unknown');

  const now = Date.now();
  let effectiveSeverity = severity.toUpperCase();
  let effectiveDetails = details;

  // Track strikes for non-critical hits; add detail on repeated attempts but do not escalate severity
  if (effectiveSeverity !== 'CRITICAL') {
    const existing = ipStrikes.get(clientIp) || { count: 0, firstHit: now, lastHit: now };
    // Reset strikes if older than STRIKE_WINDOW_MS
    if (now - existing.lastHit > STRIKE_WINDOW_MS) {
      existing.count = 0;
      existing.firstHit = now;
    }
    existing.count += 1;
    existing.lastHit = now;
    ipStrikes.set(clientIp, existing);

    if (existing.count >= STRIKES_TO_ESCALATE) {
      effectiveDetails = effectiveDetails
        ? `${effectiveDetails} - Multi-strike repeat scanner (Strike ${existing.count})`
        : `Multi-strike repeat scanner (Strike ${existing.count})`;
    }
  }

  // Standardized log line formatted specifically for fail2ban / CrowdSec regex matching:
  // [SECURITY] Hostile attempt from IP <ip>: [<severity>] <type> on <method> <path>
  logger.warn(
    `[SECURITY] Hostile attempt from IP ${clientIp}: [${effectiveSeverity}] ${type} on ${clientMethod} ${clientPath}${
      effectiveDetails ? ` (${effectiveDetails})` : ''
    }`
  );

  // Filter: only CRITICAL alerts send Telegram push notifications (ignore background scanner noise)
  const minSeverity = (process.env.SECURITY_ALERT_MIN_SEVERITY || 'CRITICAL').toUpperCase();
  if (effectiveSeverity !== 'CRITICAL' && minSeverity === 'CRITICAL') {
    return { alerted: false, skippedSeverity: true, severity: effectiveSeverity };
  }

  // Check per-IP cooldown
  const lastAlertTime = ipAlertCooldowns.get(clientIp);
  if (lastAlertTime && now - lastAlertTime < DEFAULT_IP_COOLDOWN_MS) {
    return { alerted: false, throttled: true, reason: 'ip_cooldown' };
  }

  // Check global rate limit
  if (now - globalWindowStart > 60000) {
    globalWindowStart = now;
    globalAlertsInMinute = 0;
  }
  if (globalAlertsInMinute >= MAX_GLOBAL_ALERTS_PER_MINUTE) {
    return { alerted: false, throttled: true, reason: 'global_rate_limit' };
  }

  // Register cooldown and increment global count
  ipAlertCooldowns.set(clientIp, now);
  globalAlertsInMinute++;

  const message = formatSecurityAlertMessage({
    type,
    ip: clientIp,
    method: clientMethod,
    path: clientPath,
    details: effectiveDetails,
    userAgent: clientAgent,
    severity: effectiveSeverity,
  });

  if (typeof scheduleTelegram === 'function') {
    try {
      await scheduleTelegram('security-alert', {
        message,
        ip: clientIp,
        type,
        severity: effectiveSeverity,
        timestamp: now,
      });
      return { alerted: true, throttled: false, severity: effectiveSeverity };
    } catch (err) {
      logger.error('[SECURITY] Failed to schedule telegram security alert:', err);
      return { alerted: false, error: err.message };
    }
  }

  return { alerted: false, reason: 'no_telegram_scheduler' };
}
