import { Worker, connection } from '../queueManager.js';
import logger from '../logger.js';
import OdooClient from '../odoo.js';
import { calculateMaterialUsage } from '../utils/materialCalculator.js';
import path from 'path';

let worker;

export const startOdooWorker = (db, storageProvider) => {
    if (worker) return worker;

    worker = new Worker('odoo-queue', async (job) => {
        logger.info(`[WORKER] Processing Odoo job ${job.name} (${job.id})`);

        try {
            const config = await db.getConfig();
            const odooConfig = config.odoo || {};

            // Skip if not configured
            if (!odooConfig.url || !odooConfig.db || !odooConfig.username || !odooConfig.password) {
                logger.warn('[WORKER] Odoo not configured. Skipping job.');
                return;
            }

            const odoo = new OdooClient(odooConfig);

            if (job.name === 'sync-inventory') {
                const mappings = odooConfig.mappings || {};
                const productIds = Object.values(mappings).map(Number).filter(id => !isNaN(id));

                if (productIds.length > 0) {
                    const inventory = await odoo.getInventory(productIds);

                    const cache = {};
                    // Map materialId -> quantity
                    for (const [materialId, odooId] of Object.entries(mappings)) {
                        const oid = Number(odooId);
                        if (inventory[oid]) {
                            cache[materialId] = inventory[oid].qty;
                        }
                    }
                    await db.setInventoryCache(cache);
                    logger.info('[WORKER] Inventory synced.', cache);
                }
            } else if (job.name === 'push-time-log') {
                const { taskId, duration, description } = job.data;
                const targetTaskId = taskId || odooConfig.defaults?.project_task_id;

                if (targetTaskId) {
                    await odoo.pushTimeLog(targetTaskId, duration, description);
                } else {
                    logger.warn('[WORKER] No Task ID provided for time log.');
                }
            } else if (job.name === 'push-usage') {
                 const { orderId } = job.data;
                 const order = await db.getOrder(orderId);
                 if (!order) {
                     logger.warn(`[WORKER] Order ${orderId} not found for push-usage.`);
                     return;
                 }

                 try {
                     // Get local copy of design file
                     let localPath;
                     const designPath = order.designImagePath;

                     if (storageProvider) {
                        localPath = await storageProvider.getLocalCopy(designPath);
                     } else {
                        // Fallback if storageProvider not passed (should not happen)
                        logger.error('[WORKER] Storage provider missing.');
                        return;
                     }

                     const usage = await calculateMaterialUsage(localPath);

                     // Calculate quantities
                     const qty = order.orderDetails.quantity || 1;
                     const materialAreaSqIn = usage.areaIn2 * qty * 1.1; // +10% tail/waste
                     const inkAreaSqIn = (usage.areaIn2 * (usage.inkCoveragePercent / 100)) * qty;

                     const moves = [];

                     // Material
                     const materialKey = order.orderDetails.material;
                     const materialOdooId = odooConfig.mappings?.[materialKey];
                     if (materialOdooId) {
                         moves.push({
                             product_id: Number(materialOdooId),
                             qty: materialAreaSqIn,
                             description: `Material: ${materialKey} (${materialAreaSqIn.toFixed(2)} sq in)`
                         });
                     }

                     // Ink
                     const inkOdooId = odooConfig.mappings?.['ink'];
                     if (inkOdooId) {
                         moves.push({
                             product_id: Number(inkOdooId),
                             qty: inkAreaSqIn,
                             description: `Ink Usage (${inkAreaSqIn.toFixed(2)} sq in)`
                         });
                     }

                     const pickingTypeId = odooConfig.defaults?.picking_type_id;
                     if (pickingTypeId && moves.length > 0) {
                         await odoo.createStockPicking(pickingTypeId, moves, `Order ${orderId}`);
                         logger.info(`[WORKER] Pushed usage for order ${orderId}`);
                     } else if (moves.length > 0) {
                         logger.warn('[WORKER] No Picking Type ID configured. Skipping usage push.');
                     }
                 } catch (err) {
                     logger.error(`[WORKER] Failed to calculate usage for order ${orderId}:`, err);
                 }
            }

        } catch (error) {
            logger.error(`[WORKER] Odoo job ${job.name} failed:`, error);
            throw error;
        }
    }, {
        connection,
        concurrency: 1
    });

    worker.on('failed', (job, err) => {
        logger.error(`[WORKER] Odoo job ${job.name} failed with error ${err.message}`);
    });

    logger.info('[WORKER] Odoo worker started.');
    return worker;
};
