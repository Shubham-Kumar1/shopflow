const amqp = require('amqplib');
const logger = require('../utils/logger');
const Payment = require('../models/Payment');
const { sendPaymentEvent } = require('../kafka/producer');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://shopflow:shopflow123@localhost:5672';
const EXCHANGE = 'payment.exchange';

let connection = null;
let channel = null;

async function connectConsumer() {
  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.prefetch(1);

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

  await channel.consume('payment.process', async (msg) => {
    if (!msg) return;

    try {
      const job = JSON.parse(msg.content.toString());
      const retryCount = (msg.properties.headers && msg.properties.headers['x-retry-count']) || 0;

      logger.info({ orderId: job.orderId, paymentId: job.paymentId, retryCount }, 'Processing payment');

      const success = Math.random() < 0.85;

      if (success) {
        await Payment.updateStatus(job.paymentId, 'completed');

        await sendPaymentEvent({
          eventType: 'PAYMENT_CONFIRMED',
          orderId: job.orderId,
          userId: job.userId,
          paymentId: job.paymentId,
          timestamp: new Date().toISOString()
        });

        logger.info({ orderId: job.orderId, paymentId: job.paymentId }, 'Payment completed successfully');
        channel.ack(msg);
      } else {
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000;
          logger.warn({ orderId: job.orderId, retryCount, delay }, 'Payment failed, scheduling retry');

          setTimeout(() => {
            channel.publish(EXCHANGE, 'payment.process', Buffer.from(JSON.stringify(job)), {
              persistent: true,
              headers: { 'x-retry-count': retryCount + 1 }
            });
          }, delay);

          channel.ack(msg);
        } else {
          logger.error({ orderId: job.orderId, paymentId: job.paymentId }, 'Payment failed after max retries, sending to DLQ');

          await Payment.updateStatus(job.paymentId, 'failed');

          await sendPaymentEvent({
            eventType: 'PAYMENT_FAILED',
            orderId: job.orderId,
            userId: job.userId,
            paymentId: job.paymentId,
            timestamp: new Date().toISOString()
          });

          channel.nack(msg, false, false);
        }
      }
    } catch (err) {
      logger.error({ error: err.message }, 'Error processing payment message');
      channel.nack(msg, false, false);
    }
  });

  logger.info('RabbitMQ consumer connected and listening to payment.process');
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
