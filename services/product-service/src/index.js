require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const client = require('prom-client');

const logger = require('./utils/logger');
const { router: productRoutes, redisClient } = require('./routes/products');

const app = express();
const PORT = process.env.PORT || 4002;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'product-service' });
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

app.use(productRoutes);

async function start() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/shopflow_products';
    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB');

    const server = app.listen(PORT, () => {
      logger.info(`Product Service running on port ${PORT}`);
    });

    function gracefulShutdown(signal) {
      logger.info(`${signal} received, shutting down gracefully`);
      server.close(async () => {
        try {
          await mongoose.connection.close();
          logger.info('MongoDB connection closed');
          await redisClient.quit();
          logger.info('Redis connection closed');
        } catch (err) {
          logger.error('Error during shutdown', { error: err.message });
        }
        process.exit(0);
      });
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (err) {
    logger.error('Failed to start Product Service', { error: err.message });
    process.exit(1);
  }
}

start();
