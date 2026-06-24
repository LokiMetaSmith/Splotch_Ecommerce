import { LowDbAdapter } from './database/lowdb_adapter.js';

async function run() {
    const dbData = { data: { users: {}, emailIndex: {} }, write: async () => {}, read: async () => {} };
    const adapter = new LowDbAdapter(dbData);

    console.log("Populating 100,000 users...");
    for (let i = 0; i < 100000; i++) {
        dbData.data.users[`user${i}`] = { id: `user${i}`, username: `user${i}`, email: `user${i}@example.com` };
    }

    // Simulate what happens without backfill: emailIndex is empty
    const targetEmail = 'user99999@example.com';

    console.time("O(N) Lookup");
    const user1 = await adapter.getUserByEmail(targetEmail);
    console.timeEnd("O(N) Lookup");

    // Now backfill emailIndex manually
    console.log("Backfilling index...");
    for (const [key, user] of Object.entries(adapter.db.data.users)) {
        if (user.email) {
            adapter.db.data.emailIndex[user.email] = key;
        }
    }

    console.time("O(1) Indexed Lookup");
    const user2 = await adapter.getUserByEmail(targetEmail);
    console.timeEnd("O(1) Indexed Lookup");
}

run();
