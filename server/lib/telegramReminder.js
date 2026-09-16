import { formatOrderPrintDetails, getOrderStatusKeyboard } from '../telegramHelpers.js';

export const DEFAULT_TELEGRAM_CONFIG = {
  enabled: true,
  stalledThresholdHours: 4,
  checkIntervalMinutes: 60,
  repeatReminderHours: 0, // 0 = send once until status changes; > 0 = re-nag every X hours
};

/**
 * Retrieves the current Telegram configuration from the database with default fallbacks.
 * @param {object} db - LowDB or Database Adapter instance
 * @returns {object} Normalized telegram configuration
 */
export function getTelegramConfig(db) {
  const lowdb = db?.db || db;
  const config = lowdb?.data?.config?.telegram || {};

  return {
    enabled: config.enabled !== false,
    stalledThresholdHours:
      typeof config.stalledThresholdHours === 'number' && config.stalledThresholdHours > 0
        ? config.stalledThresholdHours
        : DEFAULT_TELEGRAM_CONFIG.stalledThresholdHours,
    checkIntervalMinutes:
      typeof config.checkIntervalMinutes === 'number' && config.checkIntervalMinutes > 0
        ? config.checkIntervalMinutes
        : DEFAULT_TELEGRAM_CONFIG.checkIntervalMinutes,
    repeatReminderHours:
      typeof config.repeatReminderHours === 'number' && config.repeatReminderHours >= 0
        ? config.repeatReminderHours
        : DEFAULT_TELEGRAM_CONFIG.repeatReminderHours,
  };
}

/**
 * Checks for stalled orders and dispatches Telegram notifications according to config.
 * @param {object} params
 * @param {object} params.db
 * @param {object} params.bot
 * @param {function} params.getSecret
 * @param {object} params.logger
 * @returns {Promise<Array>} List of notified order IDs
 */
export async function checkStalledOrders({ db, bot, getSecret, logger }) {
  const log = logger || console;
  const config = getTelegramConfig(db);

  if (!config.enabled) {
    return [];
  }

  const token = typeof getSecret === 'function' ? getSecret('TELEGRAM_BOT_TOKEN') : process.env.TELEGRAM_BOT_TOKEN;
  const channelId = typeof getSecret === 'function' ? getSecret('TELEGRAM_CHANNEL_ID') : process.env.TELEGRAM_CHANNEL_ID;

  if (!bot || !bot.telegram || !token || !channelId) {
    return [];
  }

  const nowMs = Date.now();
  const stalledThresholdMs = config.stalledThresholdHours * 60 * 60 * 1000;
  const repeatCadenceMs = config.repeatReminderHours * 60 * 60 * 1000;

  const ordersToCheck = typeof db.getActiveOrders === 'function'
    ? await db.getActiveOrders()
    : Object.values((db?.db || db)?.data?.orders || {}).filter(
        o => o && o.status !== 'COMPLETED' && o.status !== 'CANCELED'
      );

  const stalledOrders = ordersToCheck.filter(order => {
    if (!order) return false;
    const lastUpdateStr = order.lastUpdatedAt || order.receivedAt;
    const lastUpdateMs = typeof lastUpdateStr === 'number' ? lastUpdateStr : Date.parse(lastUpdateStr);

    if (isNaN(lastUpdateMs) || (nowMs - lastUpdateMs) <= stalledThresholdMs) {
      return false;
    }

    if (order.stalledMessageId) {
      if (repeatCadenceMs <= 0) {
        // Only nag once until status changes
        return false;
      }
      const lastAlertMs = order.lastStalledAlertAt
        ? (typeof order.lastStalledAlertAt === 'number' ? order.lastStalledAlertAt : Date.parse(order.lastStalledAlertAt))
        : lastUpdateMs;

      if (!isNaN(lastAlertMs) && (nowMs - lastAlertMs) < repeatCadenceMs) {
        return false;
      }
    }

    return true;
  });

  const notifiedOrders = [];

  const baseUrl = typeof getSecret === 'function' ? getSecret('BASE_URL') : process.env.BASE_URL;

  for (const order of stalledOrders) {
    const isRepeat = !!order.stalledMessageId;
    const printDetails = formatOrderPrintDetails(order, baseUrl);
    const message = `
⚠️ Order Stalled${isRepeat ? ' (Reminder)' : ''}: ${order.orderId}
Status: ${order.status}
Customer: ${order.billingContact?.givenName || ''} ${order.billingContact?.familyName || ''}
Quantity: ${order.orderDetails?.quantity || 0}
Last Update: ${new Date(order.lastUpdatedAt || order.receivedAt).toLocaleString()}

${printDetails}
    `.trim();

    try {
      const keyboard = getOrderStatusKeyboard(order, baseUrl);
      let sentMessage;
      try {
        sentMessage = await bot.telegram.sendMessage(channelId, message, {
          reply_to_message_id: order.telegramMessageId,
          reply_markup: keyboard,
        });
      } catch (sendErr) {
        if (
          sendErr.response &&
          sendErr.response.error_code === 400 &&
          sendErr.response.description &&
          sendErr.response.description.includes('message to be replied not found')
        ) {
          sentMessage = await bot.telegram.sendMessage(channelId, message, {
            reply_markup: keyboard,
          });
        } else {
          throw sendErr;
        }
      }

      const orderInDb = typeof db.getOrder === 'function'
        ? await db.getOrder(order.orderId)
        : (db?.db || db)?.data?.orders?.[order.orderId];

      if (orderInDb && sentMessage) {
        orderInDb.stalledMessageId = sentMessage.message_id;
        orderInDb.lastStalledAlertAt = nowMs;
        if (typeof db.updateOrder === 'function') {
          await db.updateOrder(orderInDb);
        } else if (typeof (db?.db || db)?.write === 'function') {
          await (db?.db || db).write();
        }
      }

      notifiedOrders.push(order.orderId);

      // Delay 3 seconds between messages to avoid Telegram rate limits (skip in test environment)
      if (process.env.NODE_ENV !== 'test') {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      log.error?.('[TELEGRAM] Failed to send stalled order notification:', error);

      if (error.response && error.response.error_code === 429) {
        const retryAfter = (error.response.parameters && error.response.parameters.retry_after) || 35;
        log.info?.(`[TELEGRAM] Rate limited. Pausing notifications for ${retryAfter} seconds...`);
        if (process.env.NODE_ENV !== 'test') {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        }
      }
    }
  }

  return notifiedOrders;
}

/**
 * Starts the dynamic Telegram reminder service.
 * Periodically checks whether it is time to check for stalled orders based on config.checkIntervalMinutes.
 * @param {object} db
 * @param {object} bot
 * @param {object} options
 * @param {function} options.getSecret
 * @param {object} options.logger
 * @param {number} [options.tickMs]
 * @returns {object} Service handle with stop()
 */
export function startTelegramReminderService(db, bot, { getSecret, logger, tickMs = 60 * 1000 } = {}) {
  let lastRunMs = 0;
  let isRunning = false;

  const intervalId = setInterval(async () => {
    if (isRunning) return;

    try {
      const config = getTelegramConfig(db);
      if (!config.enabled) return;

      const cadenceMs = Math.max(1, Number(config.checkIntervalMinutes) || 60) * 60 * 1000;
      const now = Date.now();

      if (now - lastRunMs < cadenceMs) {
        return;
      }

      isRunning = true;
      lastRunMs = now;
      await checkStalledOrders({ db, bot, getSecret, logger });
    } catch (err) {
      logger?.error?.('[TELEGRAM] Error in stalled order reminder service:', err);
    } finally {
      isRunning = false;
    }
  }, tickMs);

  return {
    intervalId,
    stop: () => clearInterval(intervalId),
    triggerNow: () => checkStalledOrders({ db, bot, getSecret, logger }),
  };
}
