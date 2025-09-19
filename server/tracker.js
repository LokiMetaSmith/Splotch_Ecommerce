import EasyPost from '@easypost/api';

let db;
let api;

function initializeTracker(database) {
    db = database;
    if (process.env.EASYPOST_API_KEY) {
        api = new EasyPost(process.env.EASYPOST_API_KEY);
        // Check for updates every 5 minutes
        setInterval(updateTrackingData, 5 * 60 * 1000);
        console.log('[TRACKER] EasyPost shipment tracker initialized.');
    } else {
        console.warn('[TRACKER] EASYPOST_API_KEY is not set. Shipment tracker is disabled.');
    }
}

async function updateTrackingData() {
    if (!db || !api) return;

    const shippedOrders = db.data.orders.filter(o => o.status === 'SHIPPED' && o.trackingNumber && o.courier);

    if (shippedOrders.length === 0) {
        return;
    }

    console.log(`[TRACKER] Checking status for ${shippedOrders.length} shipped orders...`);

    for (const order of shippedOrders) {
        try {
            const tracker = await api.Tracker.create({
                tracking_code: order.trackingNumber,
                carrier: order.courier,
            });

            if (tracker.status && tracker.status.toLowerCase() === 'delivered') {
                console.log(`[TRACKER] Order ${order.orderId} has been delivered. Updating status.`);
                const orderToUpdate = db.data.orders.find(o => o.orderId === order.orderId);
                if (orderToUpdate) {
                    orderToUpdate.status = 'DELIVERED';
                    orderToUpdate.lastUpdatedAt = new Date().toISOString();
                    await db.write();
                }
            }
        } catch (error) {
            console.error(`[TRACKER] Failed to track order ${order.orderId}:`, error);
        }
    }
}

export { initializeTracker };
