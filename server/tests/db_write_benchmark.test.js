import { EncryptedJSONFile } from '../database/EncryptedJSONFile.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('EncryptedJSONFile Performance', () => {
    let originalEncryptEnv;
    let originalJwtSecret;

    beforeAll(() => {
        originalEncryptEnv = process.env.ENCRYPT_CLIENT_JSON;
        originalJwtSecret = process.env.JWT_SECRET;

        process.env.ENCRYPT_CLIENT_JSON = 'true';
        process.env.JWT_SECRET = 'benchmark-secret-32-chars-long-exactly!';
    });

    afterAll(() => {
        if (originalEncryptEnv === undefined) {
            delete process.env.ENCRYPT_CLIENT_JSON;
        } else {
            process.env.ENCRYPT_CLIENT_JSON = originalEncryptEnv;
        }

        if (originalJwtSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = originalJwtSecret;
        }
    });

    test('should write a large payload asynchronously and efficiently', async () => {
        const testFile = path.join(__dirname, 'benchmark_db.json');
        const adapter = new EncryptedJSONFile(testFile);

        // Create a large dummy payload
        const data = {
            orders: {},
            users: {},
            config: { settings: "test" }
        };

        for (let i = 0; i < 10000; i++) {
            data.orders[`order_${i}`] = { id: i, status: 'NEW', amount: Math.random() * 100 };
        }

        const payloadSizeMB = JSON.stringify(data).length / 1024 / 1024;
        expect(payloadSizeMB).toBeGreaterThan(0.5); // Ensure it's a reasonably large payload

        const start = process.hrtime.bigint();

        // Perform multiple writes to simulate load and verify non-blocking I/O
        for (let i = 0; i < 10; i++) {
            await adapter.write(data);
        }

        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        const avgWriteTime = durationMs / 10;

        // Console output to help developers see the benchmark when running tests directly
        console.log(`[Benchmark] Payload size: ~${payloadSizeMB.toFixed(2)} MB`);
        console.log(`[Benchmark] 10 writes completed in ${durationMs.toFixed(2)} ms`);
        console.log(`[Benchmark] Average write time: ${avgWriteTime.toFixed(2)} ms`);

        // We expect an average write time to be reasonable. If it's blocking `fs.writeFileSync`,
        // this could easily spike. This is a very loose assertion to prevent wildly slow regressions,
        // but primarily ensures the operation succeeds.
        expect(avgWriteTime).toBeLessThan(500); // Expecting < 500ms average per write

        expect(fs.existsSync(testFile)).toBe(true);

        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
    });
});
