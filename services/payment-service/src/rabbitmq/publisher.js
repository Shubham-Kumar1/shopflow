const amqp = require('amqplib');
const logger = require('../utils/logger');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://shopflow:shopflow123@localhost:5672';
const EXCHANGE = 'payment.exchange';

let connection = null;
let channel = null;

async function connectPublisher() {
  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });

  await channel.assertQueue('payment.dlq', { durable: true });

  await channel.assertQueue('payment.process', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': 'payment.dlq'
    }
  });
  await channel.bindQueue('payment.process', EXCHANGE, 'payment.process');

  await channel.assertQueue('payment.notifications', { durable: true });
  await channel.bindQueue('payment.notifications', EXCHANGE, 'payment.notifications');

  logger.info('RabbitMQ publisher connected');
}

function publishPaymentJob(job) {
  const message = Buffer.from(JSON.stringify(job));

  channel.publish(EXCHANGE, 'payment.process', message, { persistent: true });
  channel.publish(EXCHANGE, 'payment.notifications', message, { persistent: true });

  logger.info({ orderId: job.orderId }, 'Payment job published to RabbitMQ');
}

async function closePublisher() {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('RabbitMQ publisher closed');
  } catch (err) {
    logger.error({ error: err.message }, 'Error closing RabbitMQ publisher');
  }
}

module.exports = {
  connectPublisher,
  publishPaymentJob,
  closePublisher
};
