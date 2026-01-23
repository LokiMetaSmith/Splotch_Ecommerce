import EasyPost from '@easypost/api';
import { getSecret } from './secretManager.js';

let db;
let api;
let updateInterval; // Store interval ID for cleanup

function initializeTracker(database) {
    db = database;
    const apiKey = getSecret('EASYPOST_API_KEY');
    if (apiKey) {
        api = new EasyPost(apiKey);
        // Clear existing interval if any (for testing reload)
        if (updateInterval) clearInterval(updateInterval);
        // Check for updates every 5 minutes
        updateInterval = setInterval(updateTrackingData, 5 * 60 * 1000);
        console.log('[TRACKER] EasyPost shipment tracker initialized.');
    } else {
        console.warn('[TRACKER] EASYPOST_API_KEY is not set. Shipment tracker is disabled.');
    }
}

// Function to stop the tracker (useful for tests)
function stopTracker() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

async function updateTrackingData() {
    if (!db || !api) return;

    // Bolt Optimization: Use cached shippedOrders array instead of filtering all orders
    let shippedOrders;
    if (db.shippedOrders) {
        shippedOrders = db.shippedOrders.filter(o => o.trackingNumber && o.courier);
    } else {
        // Fallback if cache isn't initialized (shouldn't happen in normal operation)
        shippedOrders = Object.values(db.data.orders).filter(o => o.status === 'SHIPPED' && o.trackingNumber && o.courier);
    }

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
                const orderToUpdate = db.data.orders[order.orderId];
                if (orderToUpdate) {
                    orderToUpdate.status = 'DELIVERED';
                    orderToUpdate.lastUpdatedAt = new Date().toISOString();

                    // Update Cache
                    if (db.shippedOrders) {
                        const idx = db.shippedOrders.findIndex(o => o.orderId === order.orderId);
                        if (idx !== -1) {
                            db.shippedOrders.splice(idx, 1);
                        }
                    }

                    await db.write();
                }
            }
        } catch (error) {
            console.error(`[TRACKER] Failed to track order ${order.orderId}:`, error);
        }
    }
}

export { initializeTracker, updateTrackingData, stopTracker };
