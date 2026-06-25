const FINAL_STATUSES = ['SHIPPED', 'CANCELED', 'COMPLETED', 'DELIVERED'];

// Mock DB active orders
const activeOrders = [];
for (let i = 0; i < 100000; i++) {
  activeOrders.push({
    orderId: `ORDER-${i}`,
    status: i % 10 === 0 ? 'PENDING' : 'PROCESSING',
    receivedAt: new Date(Date.now() - (i % 10 === 0 ? 5 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000)).toISOString(), // Some stalled, some not
  });
}

function runBenchmark() {
  const start = performance.now();
  const now = new Date();

  for (let iter = 0; iter < 100; iter++) {
    const stalledOrders = activeOrders.filter(order => {
      if (FINAL_STATUSES.includes(order.status)) {
        return false;
      }
      const lastUpdatedAt = new Date(order.lastUpdatedAt || order.receivedAt);
      const hoursSinceUpdate = (now - lastUpdatedAt) / 1000 / 60 / 60;
      return hoursSinceUpdate > 4;
    });
  }

  const end = performance.now();
  return end - start;
}

function runBenchmarkOptimized() {
  const start = performance.now();
  const now = Date.now();
  const fourHoursMs = 4 * 60 * 60 * 1000;

  for (let iter = 0; iter < 100; iter++) {
    const stalledOrders = activeOrders.filter(order => {
      const lastUpdatedAt = order.lastUpdatedAt || order.receivedAt;
      const timeSinceUpdate = now - (typeof lastUpdatedAt === 'number' ? lastUpdatedAt : Date.parse(lastUpdatedAt));
      return timeSinceUpdate > fourHoursMs;
    });
  }

  const end = performance.now();
  return end - start;
}

const baseline = runBenchmark();
const optimized = runBenchmarkOptimized();

console.log(`Baseline: ${baseline.toFixed(2)} ms`);
console.log(`Optimized: ${optimized.toFixed(2)} ms`);
console.log(`Improvement: ${((baseline - optimized) / baseline * 100).toFixed(2)}%`);
