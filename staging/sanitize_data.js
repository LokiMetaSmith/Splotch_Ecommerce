import { faker } from '@faker-js/faker';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDbPath = path.join(__dirname, '../server/db.json');
const stagingDbPath = path.join(__dirname, 'server/db.staging.json');
const stagingDir = path.dirname(stagingDbPath);

console.log('🌿 Starting data sanitization...');

// Ensure staging directory exists
if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
}

// Check if source db.json exists
if (!fs.existsSync(sourceDbPath)) {
    console.error(`❌ Source database not found at ${sourceDbPath}`);
    console.error('Please ensure a production db.json file is present in the server/ directory.');
    process.exit(1);
}

try {
    const dbData = JSON.parse(fs.readFileSync(sourceDbPath, 'utf-8'));
    const sanitizedData = { ...dbData };

    // Sanitize Orders
    if (sanitizedData.orders && Array.isArray(sanitizedData.orders)) {
        console.log(`Sanitizing ${sanitizedData.orders.length} orders...`);
        sanitizedData.orders = sanitizedData.orders.map(order => {
            const sanitizedOrder = { ...order };
            if (sanitizedOrder.billingContact) {
                sanitizedOrder.billingContact.givenName = faker.person.firstName();
                sanitizedOrder.billingContact.familyName = faker.person.lastName();
                sanitizedOrder.billingContact.email = faker.internet.email();
                if (sanitizedOrder.billingContact.addressLines) {
                    sanitizedOrder.billingContact.addressLines = [faker.location.streetAddress()];
                }
                if (sanitizedOrder.billingContact.city) {
                    sanitizedOrder.billingContact.city = faker.location.city();
                }
                if (sanitizedOrder.billingContact.postalCode) {
                    sanitizedOrder.billingContact.postalCode = faker.location.zipCode();
                }
            }
            if (sanitizedOrder.shippingContact) {
                sanitizedOrder.shippingContact.givenName = faker.person.firstName();
                sanitizedOrder.shippingContact.familyName = faker.person.lastName();
                if (sanitizedOrder.shippingContact.addressLines) {
                    sanitizedOrder.shippingContact.addressLines = [faker.location.streetAddress()];
                }
                if (sanitizedOrder.shippingContact.city) {
                    sanitizedOrder.shippingContact.city = faker.location.city();
                }
                if (sanitizedOrder.shippingContact.postalCode) {
                    sanitizedOrder.shippingContact.postalCode = faker.location.zipCode();
                }
            }
            return sanitizedOrder;
        });
    }

    // Sanitize Users
    if (sanitizedData.users && typeof sanitizedData.users === 'object') {
        console.log(`Sanitizing ${Object.keys(sanitizedData.users).length} users...`);
        const sanitizedUsers = {};
        for (const userId in sanitizedData.users) {
            const user = sanitizedData.users[userId];
            const sanitizedUser = { ...user };
            const fakeUsername = faker.internet.userName().toLowerCase();
            sanitizedUser.username = fakeUsername;
            if (sanitizedUser.email) {
                sanitizedUser.email = faker.internet.email();
            }
            // Keep the password hash for login testing, but in a real scenario, you might nullify it.
            // sanitizedUser.password = null;
            sanitizedUsers[userId] = sanitizedUser;
        }
        sanitizedData.users = sanitizedUsers;
    }

    fs.writeFileSync(stagingDbPath, JSON.stringify(sanitizedData, null, 2));
    console.log(`✅ Sanitization complete! Staging database created at ${stagingDbPath}`);

} catch (error) {
    console.error('❌ An error occurred during sanitization:', error);
    process.exit(1);
}
