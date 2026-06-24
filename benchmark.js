import { LowDbAdapter } from './server/database/lowdb_adapter.js';
import path from 'path';

async function runBenchmark() {
    console.log("Setting up benchmark...");
    const mockLowDb = {
        data: { orders: {} },
        read: async () => {},
        write: async () => {},
        adapter: { filename: 'mock.json' }
    };

    const db = new LowDbAdapter(mockLowDb);
    // await db.init(); // it's not a method

    // Populate with 10,000 dummy orders
    for (let i = 0; i < 10000; i++) {
        const id = `order-${i}`;
        db.db.data.orders[id] = { orderId: id, status: 'NEW' };
    }

    console.log("Starting benchmark for O(1) getOrder...");
    const start = performance.now();

    // Lookup 100,000 times
    for (let i = 0; i < 100000; i++) {
        const id = `order-${Math.floor(Math.random() * 10000)}`;
        await db.getOrder(id);
    }

    const end = performance.now();
    console.log(`Time taken for 100,000 lookups: ${end - start} ms`);

    // Test Array.find performance (the O(N) baseline)
    console.log("Starting benchmark for O(N) baseline (Array.find)...");
    const orderArray = Object.values(db.db.data.orders);

    const startN = performance.now();
    for (let i = 0; i < 100000; i++) {
        const id = `order-${Math.floor(Math.random() * 10000)}`;
        orderArray.find(o => o.orderId === id);
    }
    const endN = performance.now();
    console.log(`Time taken for 100,000 lookups using Array.find: ${endN - startN} ms`);

    if (db._watcher && typeof db._watcher.unref === 'function') {
        db._watcher.unref();
    }
}

runBenchmark();
