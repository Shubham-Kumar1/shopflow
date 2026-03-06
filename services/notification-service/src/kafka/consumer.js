const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

const kafka = new Kafka({
  clientId: 'notification-service',
  brokers
});

const consumer = kafka.consumer({ groupId: 'notification-service-kafka-group' });

async function connectConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topics: ['order-events', 'payment-events'], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = JSON.parse(message.value.toString());

        switch (event.eventType) {
          case 'ORDER_PLACED':
            logger.info(
              `[NOTIFICATION] 📦 Order placed - Order #${event.orderId} for user ${event.userId} — $${event.totalAmount}`
            );
            break;

          case 'PAYMENT_CONFIRMED':
            logger.info(
              `[NOTIFICATION] ✅ Payment confirmed - Order #${event.orderId} is now confirmed. Email sent to user ${event.userId}.`
            );
            break;

          case 'PAYMENT_FAILED':
            logger.info(
              `[NOTIFICATION] ❌ Payment failed - Order #${event.orderId} has been cancelled. User ${event.userId} notified.`
            );
            break;

          default:
            logger.warn({ eventType: event.eventType }, 'Unknown event type received');
        }
      } catch (err) {
        logger.error({ error: err.message }, 'Error processing Kafka message');
      }
    }
  });

  logger.info('Kafka consumer connected and listening to order-events and payment-events');
}

async function disconnectConsumer() {
  await consumer.disconnect();
  logger.info('Kafka consumer disconnected');
}

module.exports = {
  connectConsumer,
  disconnectConsumer
};
