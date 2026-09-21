import logger from '../logger.js';

// Cooldown storage: map client IP to timestamp of last alert
const ipAlertCooldowns = new Map();
const DEFAULT_IP_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per IP

// Global alert throttle: maximum 10 alerts per minute to avoid hitting Telegram rate limits
let globalAlertsInMinute = 0;
let globalWindowStart = Date.now();
const MAX_GLOBAL_ALERTS_PER_MINUTE = 10;

// Periodic cleanup of stale cooldown entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamp] of ipAlertCooldowns.entries()) {
    if (now - timestamp > DEFAULT_IP_COOLDOWN_MS * 2) {
      ipAlertCooldowns.delete(ip);
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
 * Clears the alert cooldown map. Useful for unit and integration testing.
 */
export function clearAlertCooldowns() {
  ipAlertCooldowns.clear();
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
export function formatSecurityAlertMessage({ type, ip, method, path, details, userAgent }) {
  const time = new Date().toUTCString();
  const safeAgent = sanitizeTelegramMarkdown(userAgent || 'unknown');
  const safePath = sanitizeTelegramMarkdown(path || '/');
  const safeDetails = details ? sanitizeTelegramMarkdown(details) : null;
  const safeType = sanitizeTelegramMarkdown(type || 'Hostile Activity');

  const lines = [
    `🚨 *SECURITY ALERT: ${safeType}*`,
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
    `⚠️ _Fail2ban will automatically ban this IP if hostile attempts continue._`
  );

  return lines.join('\n');
}

/**
 * Dispatches a security alert:
 * 1. ALWAYS logs a standardized [SECURITY] warning for fail2ban to capture and count towards bans.
 * 2. Checks IP and global cooldowns to prevent Telegram notification spam.
 * 3. Enqueues a Telegram alert job to notify the administrator.
 */
export async function dispatchSecurityAlert({
  type,
  ip,
  method = 'GET',
  path = '',
  details = '',
  userAgent = '',
  scheduleTelegram,
  req,
}) {
  const clientIp = ip || (req ? getClientIp(req) : 'unknown');
  const clientMethod = method || (req ? req.method : 'GET');
  const clientPath = path || (req ? (req.originalUrl || req.path) : '');
  const clientAgent = userAgent || (req?.headers ? req.headers['user-agent'] : 'unknown');

  // Standardized log line formatted specifically for fail2ban regex matching:
  // [SECURITY] Hostile attempt from IP <ip>: <type> on <method> <path>
  logger.warn(
    `[SECURITY] Hostile attempt from IP ${clientIp}: ${type} on ${clientMethod} ${clientPath}${
      details ? ` (${details})` : ''
    }`
  );

  const now = Date.now();

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
    details,
    userAgent: clientAgent,
  });

  if (typeof scheduleTelegram === 'function') {
    try {
      await scheduleTelegram('security-alert', {
        message,
        ip: clientIp,
        type,
        timestamp: now,
      });
      return { alerted: true, throttled: false };
    } catch (err) {
      logger.error('[SECURITY] Failed to schedule telegram security alert:', err);
      return { alerted: false, error: err.message };
    }
  }

  return { alerted: false, reason: 'no_telegram_scheduler' };
}
