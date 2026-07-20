import { JSONFilePreset } from 'lowdb/node';
import { LowDbAdapter } from './database/lowdb_adapter.js';
import crypto from 'crypto';

async function runBenchmark() {
    console.log("Setting up benchmark...");
    const db = await JSONFilePreset('test_benchmark_db.json', { users: {}, emailIndex: {} });
    const adapter = new LowDbAdapter(db);

    const numUsers = 10000;
    const targetEmail = `user${numUsers - 1}@example.com`;

    adapter.db.data.emailIndex = {};

    for (let i = 0; i < numUsers; i++) {
        const id = crypto.randomUUID();
        const user = { id, email: `user${i}@example.com`, username: `user${i}` };
        adapter.db.data.users[id] = user;
    }

    console.log(`Benchmarking O(N) fallback with ${numUsers} users...`);
    const startN = process.hrtime.bigint();
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
        await adapter.getUserByEmail(targetEmail);
    }
    const endN = process.hrtime.bigint();
    const durationN = Number(endN - startN) / 1e6;
    console.log(`O(N) duration for ${iterations} lookups: ${durationN.toFixed(2)} ms`);

    console.log("Building index...");
    for (let i = 0; i < numUsers; i++) {
        const email = `user${i}@example.com`;
        const user = Object.values(adapter.db.data.users).find(u => u.email === email);
        if(user) {
            adapter.db.data.emailIndex[user.email] = user.id;
        }
    }

    console.log(`Benchmarking O(1) index with ${numUsers} users...`);
    const start1 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        await adapter.getUserByEmail(targetEmail);
    }
    const end1 = process.hrtime.bigint();
    const duration1 = Number(end1 - start1) / 1e6;
    console.log(`O(1) duration for ${iterations} lookups: ${duration1.toFixed(2)} ms`);

    import('fs').then(fs => {
        try { fs.unlinkSync('test_benchmark_db.json') } catch(e){}
    });
}

runBenchmark().catch(console.error);
