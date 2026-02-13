import { jest } from '@jest/globals';
import { Queue, Worker, redisAvailable } from '../queueManager.js';

describe('Queue Manager', () => {
    it('should export Queue and Worker', () => {
        expect(Queue).toBeDefined();
        expect(Worker).toBeDefined();
    });

    // We can't easily assert on redisAvailable being false because the test environment might have Redis?
    // But we can check if Queue behaves like our Mock if redisAvailable is false.

    if (!redisAvailable) {
        it('should use MockQueue when Redis is unavailable', async () => {
            const queueName = 'test-queue-' + Date.now();
            const queue = new Queue(queueName);
            const processFn = jest.fn();

            const worker = new Worker(queueName, async (job) => {
                processFn(job.data);
            });

            await queue.add('test-job', { foo: 'bar' });

            // Wait for next tick/immediate
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(processFn).toHaveBeenCalledWith({ foo: 'bar' });
        });
    }
});
