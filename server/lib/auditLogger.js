import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getAuditLogPath() {
    if (process.env.AUDIT_LOG_PATH) {
        return process.env.AUDIT_LOG_PATH;
    }
    return path.resolve(__dirname, '..', 'data', 'order_audit.jsonl');
}

function ensureAuditDir(filePath) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (err) {
        logger.error('[AUDIT] Failed to create audit log directory:', err);
    }
}

export function logOrderTransition({
    order,
    orderId,
    fromStatus = null,
    toStatus,
    actor = { type: 'system', id: 'system' },
    note = null,
    metadata = {}
}) {
    const id = orderId || order?.orderId;
    if (!id) {
        logger.error('[AUDIT] Cannot log transition without orderId');
        return null;
    }

    const eventId = `evt_${Date.now()}_${randomUUID().substring(0, 8)}`;
    const timestamp = new Date().toISOString();

    const event = {
        eventId,
        timestamp,
        orderId: id,
        fromStatus,
        toStatus,
        actor: {
            type: actor.type || 'system',
            id: actor.id || 'unknown'
        },
        note: note || undefined,
        metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined
    };

    if (order) {
        if (!Array.isArray(order.statusHistory)) {
            order.statusHistory = [];
        }
        order.statusHistory.push(event);
    }

    try {
        const logPath = getAuditLogPath();
        ensureAuditDir(logPath);
        const line = JSON.stringify(event) + '\n';
        fs.appendFileSync(logPath, line, 'utf8');
        logger.info(`[AUDIT] Transition logged for ${id}: ${fromStatus || 'INIT'} -> ${toStatus} by ${actor.type}:${actor.id}`);
    } catch (err) {
        logger.error(`[AUDIT] Failed to append transition for ${id} to audit log:`, err);
    }

    return event;
}

export function readAuditLogForOrder(orderId) {
    const logPath = getAuditLogPath();
    if (!fs.existsSync(logPath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const events = [];
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (!orderId || parsed.orderId === orderId) {
                    events.push(parsed);
                }
            } catch {
                // Ignore corrupt lines
            }
        }
        return events;
    } catch (err) {
        logger.error('[AUDIT] Error reading audit log:', err);
        return [];
    }
}
