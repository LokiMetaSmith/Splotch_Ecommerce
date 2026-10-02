const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Determine db path (assuming lowdb for the migration script)
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../server/db.json');

function sanitizeToUUIDv4(oldId) {
    const baseUuid = crypto.randomUUID();
    let oldIdIndex = 0;
    let result = '';

    for (let i = 0; i < baseUuid.length; i++) {
        // Enforce standard dashes
        if (baseUuid[i] === '-') {
            result += '-';
            continue;
        }
        // Enforce v4 strictness (13th char is '4', 17th is '8','9','a','b')
        if (i === 14) { result += '4'; continue; } // Index 14 due to dashes
        if (i === 19) { result += baseUuid[i]; continue; } // Index 19 due to dashes

        // Overlay valid hex characters from the old ID
        let overlayChar = null;
        while (oldIdIndex < oldId.length) {
            const char = oldId[oldIdIndex].toLowerCase();
            oldIdIndex++;
            if (/[0-9a-f]/.test(char)) {
                overlayChar = char;
                break;
            }
        }

        result += overlayChar !== null ? overlayChar : baseUuid[i];
    }
    return result;
}

async function runMigration() {
    console.log('Starting order ID migration...');

    if (!fs.existsSync(dbPath)) {
        console.error(`Database file not found at: ${dbPath}`);
        process.exit(1);
    }

    const rawData = fs.readFileSync(dbPath, 'utf8');
    let dbData;
    try {
        dbData = JSON.parse(rawData);
    } catch (err) {
        console.error("Failed to parse db.json", err);
        process.exit(1);
    }

    if (!dbData || !dbData.orders) {
        console.log("No orders found in database.");
        process.exit(0);
    }

    let updatedCount = 0;
    const newOrders = {};

    for (const [oldId, order] of Object.entries(dbData.orders)) {
        // If it starts with 'ord_' or isn't 36 chars long, it needs fixing
        if (oldId.startsWith('ord_') || oldId.length !== 36) {
            const newId = sanitizeToUUIDv4(oldId);

            // Mutate the order ID and add provenance if missing
            order.orderId = newId;
            // Also fix the legacy 'order_id' property if it exists
            if (order.order_id) {
                order.order_id = newId;
            }
            order.provenance = order.provenance || 'migrated_legacy';

            newOrders[newId] = order;
            console.log(`Migrated: ${oldId} -> ${newId}`);
            updatedCount++;
        } else {
            // Ensure even valid ones have a provenance
            if (!order.provenance) {
                order.provenance = 'migrated_legacy';
                updatedCount++;
            }
            newOrders[oldId] = order;
        }
    }

    if (updatedCount > 0) {
        dbData.orders = newOrders;
        fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
        console.log(`Migration complete. Updated ${updatedCount} orders and saved to database.`);
    } else {
        console.log("No orders required migration.");
    }

    process.exit(0);
}

runMigration();
