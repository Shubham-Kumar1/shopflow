const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');
const Order = require('../models/Order');

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

const kafka = new Kafka({
  clientId: 'order-service',
  brokers
});

const consumer = kafka.consumer({ groupId: 'order-service-group' });

async function connectConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'payment-events', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        logger.info({ eventType: event.eventType, orderId: event.orderId }, 'Received payment event');

        if (event.eventType === 'PAYMENT_CONFIRMED') {
          await Order.updateStatus(event.orderId, 'confirmed');
          logger.info({ orderId: event.orderId }, 'Order confirmed after payment');
        } else if (event.eventType === 'PAYMENT_FAILED') {
          await Order.updateStatus(event.orderId, 'cancelled');
          logger.info({ orderId: event.orderId }, 'Order cancelled due to payment failure');
        }
      } catch (err) {
        logger.error({ error: err.message }, 'Error processing payment event');
      }
    }
  });

  logger.info('Kafka consumer connected and listening to payment-events');
}

async function disconnectConsumer() {
  await consumer.disconnect();
  logger.info('Kafka consumer disconnected');
}

module.exports = {
  connectConsumer,
  disconnectConsumer
};
