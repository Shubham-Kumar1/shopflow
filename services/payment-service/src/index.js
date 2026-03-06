require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const client = require('prom-client');

const logger = require('./utils/logger');
const Payment = require('./models/Payment');
const paymentRoutes = require('./routes/payments');
const { connectProducer, disconnectProducer } = require('./kafka/producer');
const { connectPublisher, closePublisher } = require('./rabbitmq/publisher');
const { connectConsumer: connectRabbitConsumer, closeConsumer: closeRabbitConsumer } = require('./rabbitmq/consumer');

const app = express();
const PORT = process.env.PORT || 4004;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'payment-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use(paymentRoutes);

async function connectWithRetry(connectFn, name, maxRetries = 10) {
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
    await Payment.init();
    logger.info('Database initialized');

    await connectWithRetry(connectProducer, 'Kafka producer');
    await connectWithRetry(connectPublisher, 'RabbitMQ publisher');
    await connectWithRetry(connectRabbitConsumer, 'RabbitMQ consumer');

    app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Payment service started');
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to start payment service');
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down payment service');
  try {
    await disconnectProducer();
    await closePublisher();
    await closeRabbitConsumer();
    await Payment.pool.end();
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
