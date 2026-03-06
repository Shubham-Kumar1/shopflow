require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');

const logger = require('./utils/logger');
const { register, httpRequestDuration } = require('./utils/metrics');
const authMiddleware = require('./middleware/auth');
const { globalLimiter, authLimiter, orderLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'api-gateway' });
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

app.use(globalLimiter);

app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/orders', orderLimiter);

app.use('/api/*', authMiddleware);

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.path, status_code: res.statusCode });
  });
  next();
});

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4002';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4003';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4004';

const proxyOptions = (target) => ({
  target,
  changeOrigin: true,
  logLevel: 'warn',
  onError: (err, req, res) => {
    logger.error('Proxy error', { target, error: err.message });
    res.status(502).json({ error: 'Service unavailable' });
  },
});

app.use('/api/users', createProxyMiddleware(proxyOptions(USER_SERVICE_URL)));
app.use('/api/products', createProxyMiddleware(proxyOptions(PRODUCT_SERVICE_URL)));
app.use('/api/orders', createProxyMiddleware(proxyOptions(ORDER_SERVICE_URL)));
app.use('/api/payments', createProxyMiddleware(proxyOptions(PAYMENT_SERVICE_URL)));

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const server = app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
});

function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
