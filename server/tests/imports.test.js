import { describe, it, expect } from '@jest/globals';

describe('Ad-hoc Import Scripts Regression Test', () => {
    it('should successfully import BullMQ Worker', async () => {
        const { Worker } = await import('bullmq');
        expect(Worker).toBeDefined();
    });

    it('should successfully import materialCalculator', async () => {
        const { calculateMaterialUsage } = await import('../utils/materialCalculator.js');
        expect(calculateMaterialUsage).toBeDefined();
    });

    it('should successfully import OdooClient', async () => {
        const module = await import('../odoo.js');
        const OdooClient = module.default;
        expect(OdooClient).toBeDefined();
    });

    it('should successfully import queueManager components', async () => {
        const { emailQueue, telegramQueue } = await import('../queueManager.js');
        expect(emailQueue).toBeDefined();
        expect(telegramQueue).toBeDefined();
    });

    it('should successfully import startOdooWorker', async () => {
        const { startOdooWorker } = await import('../workers/odooWorker.js');
        expect(startOdooWorker).toBeDefined();
    });

    it('should successfully import Jimp', async () => {
        const { Jimp } = await import('jimp');
        expect(Jimp).toBeDefined();

        // Basic Jimp functionality test from test_jimp_methods.js
        const image = new Jimp({ width: 100, height: 100, color: 0xFF0000FF });
        expect(image.bitmap.width).toBe(100);

        // Use standard Jimp resize logic
        image.resize({ w: 50, h: 50 });
        expect(image.bitmap.width).toBe(50);
    });

    it('should successfully import startServer', async () => {
        const { startServer } = await import('../server.js');
        expect(startServer).toBeDefined();
    });
});
