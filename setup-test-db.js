import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDbPath = path.join(__dirname, 'server', 'test-db.json');

const mockOrders = [
  { orderId: 'order-new-1', status: 'NEW', billingContact: { email: 'test@example.com' } },
  { orderId: 'order-accepted-1', status: 'ACCEPTED', billingContact: { email: 'test@example.com' } },
  { orderId: 'order-printing-1', status: 'PRINTING', billingContact: { email: 'test@example.com' } },
  { orderId: 'order-shipped-1', status: 'SHIPPED', billingContact: { email: 'test@example.com' } },
  { orderId: 'order-delivered-1', status: 'DELIVERED', billingContact: { email: 'test@example.com' } },
  { orderId: 'order-completed-1', status: 'COMPLETED', billingContact: { email: 'test@example.com' } },
  { orderId: 'order-canceled-1', status: 'CANCELED', billingContact: { email: 'test@example.com' } },
  { orderId: 'order-new-2', status: 'NEW', billingContact: { email: 'test@example.com' } },
];

const mockUser = {
  "admin": {
    "id": "user-admin-1",
    "username": "admin",
    "password": "$2b$10$NrI6tLCEGJkD07KElrLE6.FC00saHP/HcO1gXaBxkgEtt.CoQYiA.",
    "credentials": []
  }
};

async function setup() {
  const testDbData = {
    orders: mockOrders,
    users: mockUser,
    credentials: {},
    config: {},
  };
  await fs.writeFile(testDbPath, JSON.stringify(testDbData, null, 2));
  console.log('Test database created at', testDbPath);
}

setup();
