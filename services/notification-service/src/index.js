require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const client = require('prom-client');

const logger = require('./utils/logger');
const { connectConsumer: connectKafkaConsumer, disconnectConsumer: disconnectKafkaConsumer } = require('./kafka/consumer');
const { connectConsumer: connectRabbitConsumer, closeConsumer: closeRabbitConsumer } = require('./rabbitmq/consumer');

const app = express();
const PORT = process.env.PORT || 4005;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'notification-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

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
    await connectWithRetry(connectKafkaConsumer, 'Kafka consumer');
    await connectWithRetry(connectRabbitConsumer, 'RabbitMQ consumer');

    app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Notification service started');
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to start notification service');
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down notification service');
  try {
    await disconnectKafkaConsumer();
    await closeRabbitConsumer();
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
