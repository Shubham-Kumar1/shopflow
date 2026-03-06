require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const client = require('prom-client');

const logger = require('./utils/logger');
const Order = require('./models/Order');
const orderRoutes = require('./routes/orders');
const { connectProducer, disconnectProducer } = require('./kafka/producer');
const { connectConsumer, disconnectConsumer } = require('./kafka/consumer');

const app = express();
const PORT = process.env.PORT || 4003;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'order-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use(orderRoutes);

async function connectKafkaWithRetry(connectFn, name, maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await connectFn();
      return;
    } catch (err) {
      logger.warn({ attempt, maxRetries, error: err.message }, `${name} connection attempt failed`);
      if (attempt === maxRetries) {
        logger.error(`${name} failed after ${maxRetries} attempts`);
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function start() {
  try {
    await Order.init();
    logger.info('Database initialized');

    await connectKafkaWithRetry(connectProducer, 'Kafka producer');
    await connectKafkaWithRetry(connectConsumer, 'Kafka consumer');

    app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Order service started');
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to start order service');
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down order service');
  try {
    await disconnectProducer();
    await disconnectConsumer();
    await Order.pool.end();
    logger.info('All connections closed');
    process.exit(0);
  } catch (err) {
    logger.error({ error: err.message }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
