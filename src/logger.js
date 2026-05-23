const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) =>
      stack ? `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}` : `${timestamp} [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: '/var/log/ai-gateway.log', maxsize: 5 * 1024 * 1024, maxFiles: 3 })
  ]
});

module.exports = logger;
