import logger from '../logger.js';

export class LowDbAdapter {
    constructor(db) {
        this.db = db;
        // Ensure structure exists
        if (!this.db.data) this.db.data = {};
        if (!this.db.data.orders) this.db.data.orders = {};

        // MIGRATION: Convert orders array to object if necessary
        if (Array.isArray(this.db.data.orders)) {
            logger.info('[LowDbAdapter] Migrating orders from Array to Object...');
            const ordersArray = this.db.data.orders;
            const ordersObject = {};
            ordersArray.forEach(order => {
              if (order.orderId) {
                ordersObject[order.orderId] = order;
              } else {
                logger.warn('[LowDbAdapter] Found order without orderId during migration, skipping:', order);
              }
            });
            this.db.data.orders = ordersObject;
            // Note: This change is in-memory. It will be persisted on the next write operation.
        }

        if (!this.db.data.users) this.db.data.users = {};
        if (!this.db.data.products) this.db.data.products = {};
        if (!this.db.data.credentials) this.db.data.credentials = {};
        if (!this.db.data.config) this.db.data.config = {};
        if (!this.db.data.emailIndex) this.db.data.emailIndex = {};
        if (!this.db.data.inventory_cache) this.db.data.inventory_cache = {};

        this.FINAL_STATUSES = ['SHIPPED', 'CANCELED', 'COMPLETED', 'DELIVERED'];
    }

    async connect() {
        // No-op for LowDb
    }

    async write() {
        await this.db.write();
    }

    // --- Helper to manage caches ---
    _updateCaches(order, oldStatus) {
        // Initialize caches if they don't exist
        if (!this.db.activeOrders || !this.db.shippedOrders || !this.db.userOrderIndex) {
            // If caches aren't initialized, we don't need to update them incrementally
            // because they will be built on next access if we implement lazy loading correctly.
            // However, existing server.js logic initialized them on startup.
            // Let's rely on methods to initialize/use them.
            return;
        }

        const isFinal = this.FINAL_STATUSES.includes(order.status);
        const wasFinal = oldStatus ? this.FINAL_STATUSES.includes(oldStatus) : false;

        // Active Orders
        if (this.db.activeOrders) {
            const idx = this.db.activeOrders.findIndex(o => o.orderId === order.orderId);
            if (isFinal) {
                if (idx !== -1) this.db.activeOrders.splice(idx, 1);
            } else {
                if (idx !== -1) {
                    this.db.activeOrders[idx] = order;
                } else {
                    this.db.activeOrders.push(order);
                }
            }
        }

        // Shipped Orders
        if (this.db.shippedOrders) {
            if (order.status === 'SHIPPED') {
                const idx = this.db.shippedOrders.findIndex(o => o.orderId === order.orderId);
                if (idx === -1) {
                    this.db.shippedOrders.push(order);
                } else {
                    this.db.shippedOrders[idx] = order;
                }
            } else if (oldStatus === 'SHIPPED') {
                const idx = this.db.shippedOrders.findIndex(o => o.orderId === order.orderId);
                if (idx !== -1) this.db.shippedOrders.splice(idx, 1);
            }
        }

        // User Index
        if (this.db.userOrderIndex && order.billingContact?.email) {
            const email = order.billingContact.email;
            if (!this.db.userOrderIndex[email]) {
                this.db.userOrderIndex[email] = [];
            }
            const idx = this.db.userOrderIndex[email].findIndex(o => o.orderId === order.orderId);
            if (idx === -1) {
                this.db.userOrderIndex[email].push(order);
            } else {
                this.db.userOrderIndex[email][idx] = order;
            }
        }
    }

    // --- Orders ---
    async getOrder(id) {
        return this.db.data.orders[id];
    }

    async createOrder(order) {
        this.db.data.orders[order.orderId] = order;
        this._updateCaches(order);
        await this.write();
        return order;
    }

    async updateOrder(order) {
        // Cache Maintenance

        // Shipped Orders
        if (this.db.shippedOrders) {
            const idx = this.db.shippedOrders.findIndex(o => o.orderId === order.orderId);
            if (idx !== -1) {
                if (order.status !== 'SHIPPED') {
                    this.db.shippedOrders.splice(idx, 1);
                }
            } else {
                if (order.status === 'SHIPPED') {
                    this.db.shippedOrders.push(order);
                }
            }
        }

        // Active Orders
        if (this.db.activeOrders) {
            const isFinal = this.FINAL_STATUSES.includes(order.status);
            const idx = this.db.activeOrders.findIndex(o => o.orderId === order.orderId);
            if (idx !== -1) {
                if (isFinal) {
                    this.db.activeOrders.splice(idx, 1);
                }
            } else {
                if (!isFinal) {
                    this.db.activeOrders.push(order);
                }
            }
        }

        // User Index (Updates automatically by reference, but if email changed?)
        // Assuming email doesn't change for order.

        await this.write();
        return order;
    }

    // Explicit cache management methods to replicate server.js logic?
    // Or just make `getActiveOrders` fast?
    // If I build the cache on demand:

    _ensureActiveCache() {
        if (!this.db.activeOrders) {
            this.db.activeOrders = Object.values(this.db.data.orders).filter(o => !this.FINAL_STATUSES.includes(o.status));
        }
    }

    async getActiveOrders() {
        this._ensureActiveCache();
        return this.db.activeOrders;
    }

    _ensureShippedCache() {
        if (!this.db.shippedOrders) {
            this.db.shippedOrders = Object.values(this.db.data.orders).filter(o => o.status === 'SHIPPED');
        }
    }

    async getShippedOrders() {
        this._ensureShippedCache();
        return this.db.shippedOrders;
    }

    _ensureUserIndex() {
        if (!this.db.userOrderIndex) {
            this.db.userOrderIndex = {};
            Object.values(this.db.data.orders).forEach(order => {
                const email = order.billingContact?.email;
                if (email) {
                    if (!this.db.userOrderIndex[email]) this.db.userOrderIndex[email] = [];
                    this.db.userOrderIndex[email].push(order);
                }
            });
        }
    }

    async getUserOrders(email) {
        this._ensureUserIndex();
        return this.db.userOrderIndex[email] || [];
    }

    async getAllOrders() {
        return Object.values(this.db.data.orders);
    }

    async getOrdersByStatus(statuses) {
        return Object.values(this.db.data.orders).filter(o => statuses.includes(o.status));
    }

    async searchOrders(query, email) {
        const orders = await this.getUserOrders(email);
        return orders.filter(order => order.orderId.includes(query));
    }

    async getOrderByTelegramMessageId(messageId) {
        return Object.values(this.db.data.orders).find(o => o.telegramMessageId === messageId);
    }

    async getOrderByTelegramPhotoMessageId(messageId) {
        return Object.values(this.db.data.orders).find(o => o.telegramPhotoMessageId === messageId);
    }

    // Call this when an order is updated to refresh caches if they exist
    async notifyOrderUpdate(order, oldStatus) {
         // This is called AFTER the order object is mutated but BEFORE write/save?
         // Or just use it to fix up caches.
         // If I use the _ensure methods, I need to keep them consistent.

         // Active Orders
         if (this.db.activeOrders) {
             const isFinal = this.FINAL_STATUSES.includes(order.status);
             // We don't know if it WAS final without oldStatus.
             // If we don't have oldStatus, we might have to scan?
             // Or just remove and re-add?
             const idx = this.db.activeOrders.findIndex(o => o.orderId === order.orderId);
             if (idx !== -1) {
                 if (isFinal) {
                     this.db.activeOrders.splice(idx, 1);
                 } else {
                     // Update reference (it's already same ref but strictly...)
                     this.db.activeOrders[idx] = order;
                 }
             } else {
                 if (!isFinal) {
                     this.db.activeOrders.push(order);
                 }
             }
         }

         // Shipped Orders
         if (this.db.shippedOrders) {
             const idx = this.db.shippedOrders.findIndex(o => o.orderId === order.orderId);
             if (order.status === 'SHIPPED') {
                 if (idx === -1) this.db.shippedOrders.push(order);
             } else {
                 if (idx !== -1) this.db.shippedOrders.splice(idx, 1);
             }
         }

         // User Index
         if (this.db.userOrderIndex && order.billingContact?.email) {
             const email = order.billingContact.email;
             // Ensure list exists
             if (!this.db.userOrderIndex[email]) this.db.userOrderIndex[email] = [];

             const idx = this.db.userOrderIndex[email].findIndex(o => o.orderId === order.orderId);
             if (idx === -1) {
                 this.db.userOrderIndex[email].push(order);
             }
             // if it is there, it's updated by ref
         }
    }

    // --- Users ---
    async getUser(username) {
        if (this.db.data.users[username]) return this.db.data.users[username];
        return Object.values(this.db.data.users).find(u => u.username === username);
    }

    async getUserById(id) {
         // Check if id is used as key
         if (this.db.data.users[id]) return this.db.data.users[id];
         return Object.values(this.db.data.users).find(u => u.id === id);
    }

    async getUserByEmail(email) {
        if (this.db.data.emailIndex && this.db.data.emailIndex[email]) {
            const id = this.db.data.emailIndex[email];
            return this.db.data.users[id];
        }
        return Object.values(this.db.data.users).find(u => u.email === email);
    }

    async createUser(user) {
        const key = user.id || user.username;
        this.db.data.users[key] = user;
        if (user.email) {
            this.db.data.emailIndex[user.email] = key;
        }
        await this.write();
        return user;
    }

    async updateUser(user) {
        const key = user.id || user.username;
        // In case the key strategy changed or we are updating a user found by scan
        // We should ensure we update the correct entry.
        // But for LowDbAdapter simplicity, let's assume standard key usage.
        this.db.data.users[key] = user;
        await this.write();
        return user;
    }

    // --- Products ---
    async getProduct(productId) {
        return this.db.data.products[productId];
    }

    async createProduct(product) {
        this.db.data.products[product.productId] = product;
        await this.write();
        return product;
    }

    // --- Credentials ---
    async getCredential(credentialId) {
        return this.db.data.credentials[credentialId];
    }

    async saveCredential(credential) {
        this.db.data.credentials[credential.credentialID] = credential;
        await this.write();
        return credential;
    }

    // --- Config ---
    async getConfig() {
        return this.db.data.config;
    }

    async setConfig(key, value) {
        this.db.data.config[key] = value;
        await this.write();
    }

    async getInventoryCache() {
        return this.db.data.inventory_cache;
    }

    async setInventoryCache(cache) {
        this.db.data.inventory_cache = cache;
        await this.write();
    }

    async deleteUser(username) {
        const user = await this.getUser(username);
        if (user) {
            const key = user.id || user.username;
            if (this.db.data.users[key]) {
                delete this.db.data.users[key];
            } else if (this.db.data.users[username]) {
                delete this.db.data.users[username];
            }

            if (user.email && this.db.data.emailIndex[user.email]) {
                delete this.db.data.emailIndex[user.email];
            }
            await this.write();
            return true;
        }
        return false;
    }

    async listUsernames() {
        return Object.values(this.db.data.users).map(u => u.username);
    }

    async removeCredential(username, credentialID) {
        const user = await this.getUser(username);
        if (!user) return false;

        if (user.credentials) {
             const idx = user.credentials.findIndex(c => c.credentialID === credentialID);
             if (idx !== -1) {
                 user.credentials.splice(idx, 1);
             }
        }
        if (this.db.data.credentials[credentialID]) {
            delete this.db.data.credentials[credentialID];
        }

        await this.updateUser(user);
        return true;
    }
}
