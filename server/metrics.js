import os from 'os';

class Metrics {
    constructor() {
        this.apiRequests = {
            total: 0,
            byMethod: {},
            // We avoid storing byPath to prevent memory leaks from high cardinality paths
            latencyBuckets: {
                '50ms': 0,
                '100ms': 0,
                '500ms': 0,
                '1s': 0,
                '5s': 0,
                'Inf': 0
            },
            totalLatencyMs: 0
        };

        this.dbOperations = {
            write: {
                total: 0,
                latencyBuckets: {
                    '10ms': 0,
                    '50ms': 0,
                    '100ms': 0,
                    '500ms': 0,
                    '1s': 0,
                    'Inf': 0
                },
                totalLatencyMs: 0
            }
        };

        this.system = {
            cpuUsageCheck: process.cpuUsage(), // Initial baseline
            lastCpuUsage: { user: 0, system: 0 },
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        };
    }

    trackApiLatency(method, path, durationMs) {
        this.apiRequests.total++;
        this.apiRequests.totalLatencyMs += durationMs;

        // Track by method
        if (!this.apiRequests.byMethod[method]) this.apiRequests.byMethod[method] = 0;
        this.apiRequests.byMethod[method]++;

        // Buckets
        if (durationMs <= 50) this.apiRequests.latencyBuckets['50ms']++;
        else if (durationMs <= 100) this.apiRequests.latencyBuckets['100ms']++;
        else if (durationMs <= 500) this.apiRequests.latencyBuckets['500ms']++;
        else if (durationMs <= 1000) this.apiRequests.latencyBuckets['1s']++;
        else if (durationMs <= 5000) this.apiRequests.latencyBuckets['5s']++;
        else this.apiRequests.latencyBuckets['Inf']++;
    }

    trackDbOperation(operation, durationMs) {
        if (!this.dbOperations[operation]) {
            this.dbOperations[operation] = {
                total: 0,
                latencyBuckets: {
                    '10ms': 0,
                    '50ms': 0,
                    '100ms': 0,
                    '500ms': 0,
                    '1s': 0,
                    'Inf': 0
                },
                totalLatencyMs: 0
            };
        }

        const opMetrics = this.dbOperations[operation];
        opMetrics.total++;
        opMetrics.totalLatencyMs += durationMs;

        if (durationMs <= 10) opMetrics.latencyBuckets['10ms']++;
        else if (durationMs <= 50) opMetrics.latencyBuckets['50ms']++;
        else if (durationMs <= 100) opMetrics.latencyBuckets['100ms']++;
        else if (durationMs <= 500) opMetrics.latencyBuckets['500ms']++;
        else if (durationMs <= 1000) opMetrics.latencyBuckets['1s']++;
        else opMetrics.latencyBuckets['Inf']++;
    }

    updateSystemMetrics() {
        // Memory
        this.system.memoryUsage = process.memoryUsage();
        this.system.uptime = process.uptime();

        // CPU
        const lastUsage = this.system.cpuUsageCheck;
        const newUsage = process.cpuUsage(lastUsage);

        this.system.lastCpuUsage = newUsage; // { user: ..., system: ... } in microseconds since last check

        // Store current absolute value for next comparison
        this.system.cpuUsageCheck = process.cpuUsage();
    }

    getMetrics() {
        return {
            api: this.apiRequests,
            db: this.dbOperations,
            system: {
                memory: this.system.memoryUsage,
                cpu: this.system.lastCpuUsage, // microseconds consumed since last check
                uptime: this.system.uptime
            },
            timestamp: new Date().toISOString()
        };
    }
}

export default new Metrics();
