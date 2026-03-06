const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

const kafka = new Kafka({
  clientId: 'payment-service',
  brokers
});

const producer = kafka.producer();

async function connectProducer() {
  await producer.connect();
  logger.info('Kafka producer connected');
}

async function sendPaymentEvent(event) {
  await producer.send({
    topic: 'payment-events',
    messages: [
      { key: event.orderId, value: JSON.stringify(event) }
    ]
  });
  logger.info({ eventType: event.eventType, orderId: event.orderId }, 'Payment event published');
}

async function disconnectProducer() {
  await producer.disconnect();
  logger.info('Kafka producer disconnected');
}

module.exports = {
  producer,
  connectProducer,
  sendPaymentEvent,
  disconnectProducer
};
