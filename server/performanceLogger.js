import logger from './logger.js';
import Metrics from './metrics.js';

export const performanceLogger = (req, res, next) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInMs = (diff[0] * 1e9 + diff[1]) / 1e6;

    // Track metrics
    // Use route path if available (e.g., /api/orders/:orderId) for aggregation
    // Fallback to original URL path (stripped of query params) if route not matched
    // However, req.route might not be available here if middleware runs early.
    // Express sets req.route when a route matches.
    // Since this middleware is app.use() globally, req.route might not be set until later.
    // But this is in res.on('finish'), which runs AFTER the request is fully processed.
    // So req.route SHOULD be available if a route was matched.
    const path = req.route ? req.route.path : (req.originalUrl || req.url).split('?')[0];

    Metrics.trackApiLatency(req.method, path, durationInMs);

    // Log as info level with a structured object
    logger.info('[PERFORMANCE]', {
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: durationInMs
    });
  });

  next();
};
