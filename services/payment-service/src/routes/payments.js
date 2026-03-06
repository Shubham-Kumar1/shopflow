const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Payment = require('../models/Payment');
const { publishPaymentJob } = require('../rabbitmq/publisher');
const { sendPaymentEvent } = require('../kafka/producer');
const logger = require('../utils/logger');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ data: null, message: 'Validation failed', error: errors.array() });
  }
  next();
};

router.post(
  '/api/payments/initiate',
  [
    body('orderId').isUUID().withMessage('Valid orderId is required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be positive'),
    body('paymentMethod').notEmpty().withMessage('paymentMethod is required')
  ],
  validate,
  async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) {
        return res.status(401).json({ data: null, message: 'Unauthorized', error: 'Missing x-user-id header' });
      }

      const { orderId, amount, paymentMethod } = req.body;
      const payment = await Payment.create(orderId, userId, amount, paymentMethod);

      publishPaymentJob({
        paymentId: payment.id,
        orderId,
        userId,
        amount,
        paymentMethod
      });

      logger.info({ paymentId: payment.id, orderId }, 'Payment initiated');

      res.status(201).json({
        data: payment,
        message: 'Payment initiated',
        error: null
      });
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to initiate payment');
      res.status(500).json({ data: null, message: 'Internal server error', error: err.message });
    }
  }
);

router.get(
  '/api/payments/:orderId',
  [param('orderId').isUUID().withMessage('Valid orderId is required')],
  validate,
  async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) {
        return res.status(401).json({ data: null, message: 'Unauthorized', error: 'Missing x-user-id header' });
      }

      const payment = await Payment.findByOrderId(req.params.orderId);
      if (!payment) {
        return res.status(404).json({ data: null, message: 'Payment not found', error: null });
      }

      res.json({ data: payment, message: 'Payment retrieved', error: null });
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to fetch payment');
      res.status(500).json({ data: null, message: 'Internal server error', error: err.message });
    }
  }
);

router.post(
  '/api/payments/webhook',
  [
    body('paymentId').isUUID().withMessage('Valid paymentId is required'),
    body('status').isIn(['completed', 'failed']).withMessage('Status must be completed or failed'),
    body('stripePaymentId').optional().isString()
  ],
  validate,
  async (req, res) => {
    try {
      const { paymentId, status, stripePaymentId } = req.body;

      const payment = await Payment.updateStatus(paymentId, status, stripePaymentId);
      if (!payment) {
        return res.status(404).json({ data: null, message: 'Payment not found', error: null });
      }

      if (status === 'completed') {
        await sendPaymentEvent({
          eventType: 'PAYMENT_CONFIRMED',
          orderId: payment.order_id,
          userId: payment.user_id,
          paymentId: payment.id,
          timestamp: new Date().toISOString()
        });
      } else if (status === 'failed') {
        await sendPaymentEvent({
          eventType: 'PAYMENT_FAILED',
          orderId: payment.order_id,
          userId: payment.user_id,
          paymentId: payment.id,
          timestamp: new Date().toISOString()
        });
      }

      logger.info({ paymentId, status }, 'Payment webhook processed');

      res.json({ data: payment, message: 'Webhook processed', error: null });
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to process webhook');
      res.status(500).json({ data: null, message: 'Internal server error', error: err.message });
    }
  }
);

module.exports = router;
