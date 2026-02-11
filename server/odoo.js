import xmlrpc from 'xmlrpc';
import logger from './logger.js';

class OdooClient {
    constructor(config) {
        this.url = config.url;
        this.db = config.db;
        this.username = config.username;
        this.password = config.password;
        this.uid = null;

        if (this.url) {
            const urlParts = new URL(this.url);
            const isSecure = urlParts.protocol === 'https:';
            const clientCreator = isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient;

            const commonPath = `${urlParts.pathname.replace(/\/$/, '')}/xmlrpc/2/common`;
            const objectPath = `${urlParts.pathname.replace(/\/$/, '')}/xmlrpc/2/object`;

            this.commonClient = clientCreator({
                host: urlParts.hostname,
                port: urlParts.port ? parseInt(urlParts.port) : (isSecure ? 443 : 80),
                path: commonPath
            });

            this.objectClient = clientCreator({
                host: urlParts.hostname,
                port: urlParts.port ? parseInt(urlParts.port) : (isSecure ? 443 : 80),
                path: objectPath
            });
        }
    }

    async connect() {
        if (!this.url) {
            throw new Error('Odoo URL not configured');
        }

        return new Promise((resolve, reject) => {
            this.commonClient.methodCall('authenticate', [
                this.db,
                this.username,
                this.password,
                {}
            ], (error, uid) => {
                if (error) {
                    logger.error('[ODOO] Authentication failed:', error);
                    reject(error);
                } else if (!uid) {
                    logger.error('[ODOO] Authentication failed: No UID returned (check credentials).');
                    reject(new Error('Authentication failed'));
                } else {
                    this.uid = uid;
                    logger.info(`[ODOO] Connected successfully. UID: ${uid}`);
                    resolve(uid);
                }
            });
        });
    }

    async ensureConnection() {
        if (!this.uid) {
            await this.connect();
        }
    }

    async execute(model, method, args = [], kwargs = {}) {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            this.objectClient.methodCall('execute_kw', [
                this.db,
                this.uid,
                this.password,
                model,
                method,
                args,
                kwargs
            ], (error, value) => {
                if (error) {
                    logger.error(`[ODOO] Error executing ${model}.${method}:`, error);
                    reject(error);
                } else {
                    resolve(value);
                }
            });
        });
    }

    async testConnection() {
        try {
            await this.connect();
            // Try a simple read to verify permissions
            const version = await new Promise((resolve, reject) => {
                this.commonClient.methodCall('version', [], (error, value) => {
                     if (error) reject(error);
                     else resolve(value);
                });
            });
            logger.info('[ODOO] Version info:', version);
            return { success: true, version };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getInventory(productIds) {
        if (!productIds || productIds.length === 0) return {};

        try {
            const fields = ['id', 'display_name', 'qty_available', 'uom_id'];
            const records = await this.execute('product.product', 'read', [productIds], { fields });

            const inventory = {};
            records.forEach(record => {
                inventory[record.id] = {
                    name: record.display_name,
                    qty: record.qty_available,
                    uom: record.uom_id ? record.uom_id[1] : 'Units'
                };
            });
            return inventory;
        } catch (error) {
            logger.error('[ODOO] Failed to fetch inventory:', error);
            throw error;
        }
    }

    // Creates a Timesheet Entry
    // task_id: integer (Odoo Project Task ID)
    // duration: float (Hours)
    // description: string
    // user_id: integer (Optional, Odoo User ID, defaults to authenticated user if not set or restricted)
    async pushTimeLog(taskId, duration, description) {
         try {
            const data = {
                task_id: taskId,
                name: description,
                unit_amount: duration, // Duration in hours
            };

            // Note: user_id might be automatically set by Odoo based on context/uid

            const id = await this.execute('account.analytic.line', 'create', [data]);
            logger.info(`[ODOO] Time log created. ID: ${id}`);
            return id;
         } catch (error) {
             logger.error('[ODOO] Failed to push time log:', error);
             throw error;
         }
    }

    // Creates a Stock Picking (Consumption)
    // pickingTypeId: integer (Odoo Operation Type ID for "Manufacturing" or "Internal Transfer")
    // moves: Array of objects { product_id, qty, uom_id (optional) }
    async createStockPicking(pickingTypeId, moves, ref = '') {
        try {
            // 1. Create the Picking Header
            const pickingData = {
                picking_type_id: pickingTypeId,
                origin: ref,
                move_type: 'direct', // Consume immediately
                location_id: 8, // Source Location (e.g., Stock). Needs config!
                location_dest_id: 5, // Dest Location (e.g., Production/Customer). Needs config!
            };

            // Fetch picking type to get default locations
            const pickingTypes = await this.execute('stock.picking.type', 'read', [[pickingTypeId]], { fields: ['default_location_src_id', 'default_location_dest_id'] });
            if (pickingTypes && pickingTypes.length > 0) {
                 if (pickingTypes[0].default_location_src_id) pickingData.location_id = pickingTypes[0].default_location_src_id[0];
                 if (pickingTypes[0].default_location_dest_id) pickingData.location_dest_id = pickingTypes[0].default_location_dest_id[0];
            }

            const pickingId = await this.execute('stock.picking', 'create', [pickingData]);
            logger.info(`[ODOO] Created Draft Picking ID: ${pickingId}`);

            // 2. Create Stock Moves
            for (const move of moves) {
                const moveData = {
                    name: move.description || `Consumption for ${ref}`,
                    picking_id: pickingId,
                    product_id: move.product_id,
                    product_uom_qty: move.qty,
                    product_uom: move.uom_id || 1, // Default Unit
                    location_id: pickingData.location_id,
                    location_dest_id: pickingData.location_dest_id
                };
                await this.execute('stock.move', 'create', [moveData]);
            }

            // 3. Mark as Todo (Confirm) - Optional, depends on workflow
            // await this.execute('stock.picking', 'action_confirm', [[pickingId]]);

            // 4. Validate (Done) - Optional, often better to leave as draft for review
            // await this.execute('stock.picking', 'button_validate', [[pickingId]]);

            return pickingId;
        } catch (error) {
            logger.error('[ODOO] Failed to create stock picking:', error);
            throw error;
        }
    }
}

export default OdooClient;
