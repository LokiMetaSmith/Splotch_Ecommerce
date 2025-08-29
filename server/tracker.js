import tracker from 'delivery-tracker';

let db;

function initializeTracker(database) {
    db = database;
    // Check for updates every 5 minutes
    setInterval(updateTrackingData, 5 * 60 * 1000);
    console.log('[TRACKER] Shipment tracker initialized.');
}

async function updateTrackingData() {
    if (!db) return;

    const shippedOrders = db.data.orders.filter(o => o.status === 'SHIPPED' && o.trackingNumber && o.courier);

    if (shippedOrders.length === 0) {
        return;
    }

    console.log(`[TRACKER] Checking status for ${shippedOrders.length} shipped orders...`);

    for (const order of shippedOrders) {
        try {
            const courier = tracker.courier(order.courier);
            courier.trace(order.trackingNumber, (err, result) => {
                if (err) {
                    console.error(`[TRACKER] Error tracking order ${order.orderId}:`, err);
                    return;
                }

                if (result.status === 'Delivered') {
                    console.log(`[TRACKER] Order ${order.orderId} has been delivered. Updating status.`);
                    const orderToUpdate = db.data.orders.find(o => o.orderId === order.orderId);
                    if (orderToUpdate) {
                        orderToUpdate.status = 'DELIVERED';
                        orderToUpdate.lastUpdatedAt = new Date().toISOString();
                        db.write();
                    }
                }
            });
        } catch (error) {
            console.error(`[TRACKER] Failed to track order ${order.orderId}:`, error);
        }
    }
}

export { initializeTracker };
