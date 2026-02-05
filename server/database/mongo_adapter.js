import { MongoClient } from 'mongodb';

export class MongoDbAdapter {
    constructor(url, dbName = 'printshop') {
        this.client = new MongoClient(url);
        this.dbName = dbName;
        this.db = null;
        this.FINAL_STATUSES = ['SHIPPED', 'CANCELED', 'COMPLETED', 'DELIVERED'];
    }

    async connect() {
        if (!this.db) {
            await this.client.connect();
            this.db = this.client.db(this.dbName);
            // Create indexes
            await this.db.collection('orders').createIndex({ orderId: 1 }, { unique: true });
            await this.db.collection('orders').createIndex({ status: 1 });
            await this.db.collection('orders').createIndex({ 'billingContact.email': 1 });
            await this.db.collection('orders').createIndex({ telegramMessageId: 1 });
            await this.db.collection('orders').createIndex({ telegramPhotoMessageId: 1 });

            await this.db.collection('users').createIndex({ username: 1 }, { unique: true, sparse: true });
            await this.db.collection('users').createIndex({ email: 1 });
            await this.db.collection('users').createIndex({ id: 1 }, { unique: true });

            await this.db.collection('products').createIndex({ productId: 1 }, { unique: true });

            await this.db.collection('credentials').createIndex({ credentialID: 1 }, { unique: true });
        }
    }

    async write() {
        // No-op for MongoDB as writes are immediate
    }

    // --- Orders ---
    async getOrder(id) {
        const order = await this.db.collection('orders').findOne({ orderId: id });
        if (order) delete order._id;
        return order;
    }

    async createOrder(order) {
        await this.db.collection('orders').insertOne({ ...order });
        return order;
    }

    async updateOrder(order) {
        const { _id, ...doc } = order;
        await this.db.collection('orders').replaceOne({ orderId: order.orderId }, doc);
        return order;
    }

    async getAllOrders() {
        const orders = await this.db.collection('orders').find().toArray();
        return orders.map(o => { delete o._id; return o; });
    }

    async getActiveOrders() {
        const orders = await this.db.collection('orders').find({ status: { $nin: this.FINAL_STATUSES } }).toArray();
        return orders.map(o => { delete o._id; return o; });
    }

    async getShippedOrders() {
        const orders = await this.db.collection('orders').find({ status: 'SHIPPED' }).toArray();
        return orders.map(o => { delete o._id; return o; });
    }

    async getUserOrders(email) {
        const orders = await this.db.collection('orders').find({ 'billingContact.email': email }).toArray();
        return orders.map(o => { delete o._id; return o; });
    }

    async getOrdersByStatus(statuses) {
         const orders = await this.db.collection('orders').find({ status: { $in: statuses } }).toArray();
         return orders.map(o => { delete o._id; return o; });
    }

    async searchOrders(query, email) {
        const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const orders = await this.db.collection('orders').find({
            'billingContact.email': email,
            orderId: { $regex: safeQuery, $options: 'i' }
        }).toArray();
        return orders.map(o => { delete o._id; return o; });
    }

    async getOrderByTelegramMessageId(messageId) {
        const order = await this.db.collection('orders').findOne({ telegramMessageId: messageId });
        if (order) delete order._id;
        return order;
    }

    async getOrderByTelegramPhotoMessageId(messageId) {
        const order = await this.db.collection('orders').findOne({ telegramPhotoMessageId: messageId });
        if (order) delete order._id;
        return order;
    }

    // --- Users ---
    async getUser(username) {
        const user = await this.db.collection('users').findOne({ username: username });
        if (user) delete user._id;
        return user;
    }

    async getUserById(id) {
        const user = await this.db.collection('users').findOne({ id: id });
        if (user) delete user._id;
        return user;
    }

    async getUserByEmail(email) {
        const user = await this.db.collection('users').findOne({ email: email });
        if (user) delete user._id;
        return user;
    }

    async createUser(user) {
        await this.db.collection('users').insertOne({ ...user });
        return user;
    }

    async updateUser(user) {
        const { _id, ...doc } = user;
        if (user.id) {
             await this.db.collection('users').replaceOne({ id: user.id }, doc);
        } else {
             await this.db.collection('users').replaceOne({ username: user.username }, doc);
        }
        return user;
    }

    // --- Products ---
    async getProduct(productId) {
        const product = await this.db.collection('products').findOne({ productId: productId });
        if (product) delete product._id;
        return product;
    }

    async createProduct(product) {
        await this.db.collection('products').insertOne({ ...product });
        return product;
    }

    // --- Credentials ---
    async getCredential(credentialId) {
        const cred = await this.db.collection('credentials').findOne({ credentialID: credentialId });
        if (cred) delete cred._id;
        return cred;
    }

    async saveCredential(credential) {
        const { _id, ...doc } = credential;
        await this.db.collection('credentials').updateOne(
            { credentialID: credential.credentialID },
            { $set: doc },
            { upsert: true }
        );
        return credential;
    }

    // --- Config ---
    async getConfig() {
        const configDoc = await this.db.collection('config').findOne({ _id: 'main' });
        return configDoc ? configDoc.data : {};
    }

    async setConfig(key, value) {
        await this.db.collection('config').updateOne(
            { _id: 'main' },
            { $set: { [`data.${key}`]: value } },
            { upsert: true }
        );
    }

    async deleteUser(username) {
        const result = await this.db.collection('users').deleteOne({ username: username });
        return result.deletedCount > 0;
    }

    async listUsernames() {
        const users = await this.db.collection('users').find({}, { projection: { username: 1 } }).toArray();
        return users.map(u => u.username);
    }

    async removeCredential(username, credentialID) {
        const user = await this.getUser(username);
        if (!user) return false;

        if (user.credentials) {
             const newCreds = user.credentials.filter(c => c.credentialID !== credentialID);
             if (newCreds.length !== user.credentials.length) {
                 user.credentials = newCreds;
                 await this.updateUser(user);
             }
        }
        await this.db.collection('credentials').deleteOne({ credentialID: credentialID });
        return true;
    }
}
