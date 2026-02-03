import logger from './logger.js';

export const performanceLogger = (req, res, next) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInMs = (diff[0] * 1e9 + diff[1]) / 1e6;

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
