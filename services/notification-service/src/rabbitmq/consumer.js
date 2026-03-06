const amqp = require('amqplib');
const logger = require('../utils/logger');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://shopflow:shopflow123@localhost:5672';
const EXCHANGE = 'payment.exchange';
const QUEUE = 'notification.payments';

let connection = null;
let channel = null;

async function connectConsumer() {
  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.prefetch(1);

  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, 'payment.notifications');

  await channel.consume(QUEUE, (msg) => {
    if (!msg) return;

    try {
      const job = JSON.parse(msg.content.toString());
      logger.info(
        `[NOTIFICATION] 💳 Processing payment of $${job.amount} for order ${job.orderId}`
      );
      channel.ack(msg);
    } catch (err) {
      logger.error({ error: err.message }, 'Error processing RabbitMQ notification');
      channel.nack(msg, false, false);
    }
  });

  logger.info('RabbitMQ consumer connected and listening to notification.payments');
}

async function closeConsumer() {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('RabbitMQ consumer closed');
  } catch (err) {
    logger.error({ error: err.message }, 'Error closing RabbitMQ consumer');
  }
}

module.exports = {
  connectConsumer,
  closeConsumer
};
