require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const client = require('prom-client');

const logger = require('./utils/logger');
const User = require('./models/User');
const { router: userRoutes, redisClient } = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 4001;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'user-service' });
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

app.use(userRoutes);

async function start() {
  try {
    await User.init();
    logger.info('Database initialized');

    const server = app.listen(PORT, () => {
      logger.info(`User Service running on port ${PORT}`);
    });

    function gracefulShutdown(signal) {
      logger.info(`${signal} received, shutting down gracefully`);
      server.close(async () => {
        try {
          await User.pool.end();
          logger.info('PostgreSQL pool closed');
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
    logger.error('Failed to start User Service', { error: err.message });
    process.exit(1);
  }
}

start();
