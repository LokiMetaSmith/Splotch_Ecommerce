import { jest } from '@jest/globals';
import Metrics from '../metrics.js';

describe('Metrics Unit Tests', () => {
    test('should track API latency', () => {
        const initialTotal = Metrics.apiRequests.total;
        Metrics.trackApiLatency('GET', '/test', 100);

        expect(Metrics.apiRequests.total).toBe(initialTotal + 1);
        expect(Metrics.apiRequests.byMethod['GET']).toBeDefined();
        expect(Metrics.apiRequests.latencyBuckets['100ms']).toBeGreaterThan(0);
    });

    test('should track DB operations', () => {
        const initialTotal = Metrics.dbOperations.write.total;
        Metrics.trackDbOperation('write', 50);

        expect(Metrics.dbOperations.write.total).toBe(initialTotal + 1);
        expect(Metrics.dbOperations.write.latencyBuckets['50ms']).toBeGreaterThan(0);
    });

    test('should update system metrics', () => {
        Metrics.updateSystemMetrics();
        const metrics = Metrics.getMetrics();
        expect(metrics.system).toBeDefined();
        expect(metrics.system.memory).toBeDefined();
        expect(metrics.system.cpu).toBeDefined();
    });
});
