const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Order = require('../models/Order');
const { sendOrderEvent } = require('../kafka/producer');
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
  '/api/orders',
  [
    body('items').isArray({ min: 1 }).withMessage('Items must be a non-empty array'),
    body('items.*.productId').notEmpty().withMessage('productId is required'),
    body('items.*.productName').notEmpty().withMessage('productName is required'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('quantity must be at least 1'),
    body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('unitPrice must be non-negative'),
    body('shippingAddress').isObject().withMessage('shippingAddress is required'),
    body('shippingAddress.firstName').notEmpty(),
    body('shippingAddress.lastName').notEmpty(),
    body('shippingAddress.address').notEmpty(),
    body('shippingAddress.city').notEmpty(),
    body('shippingAddress.state').notEmpty(),
    body('shippingAddress.zipCode').notEmpty(),
    body('shippingAddress.country').notEmpty()
  ],
  validate,
  async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) {
        return res.status(401).json({ data: null, message: 'Unauthorized', error: 'Missing x-user-id header' });
      }

      const { items, shippingAddress } = req.body;
      const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      const order = await Order.create(userId, totalAmount, shippingAddress);
      const orderItems = await Order.addItems(order.id, items);

      await sendOrderEvent({
        eventType: 'ORDER_PLACED',
        orderId: order.id,
        userId,
        items: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
        totalAmount,
        timestamp: new Date().toISOString()
      });

      logger.info({ orderId: order.id, userId }, 'Order created');

      res.status(201).json({
        data: { ...order, items: orderItems },
        message: 'Order created successfully',
        error: null
      });
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to create order');
      res.status(500).json({ data: null, message: 'Internal server error', error: err.message });
    }
  }
);

router.get('/api/orders', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ data: null, message: 'Unauthorized', error: 'Missing x-user-id header' });
    }

    const orders = await Order.findByUserId(userId);

    res.json({ data: orders, message: 'Orders retrieved', error: null });
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to fetch orders');
    res.status(500).json({ data: null, message: 'Internal server error', error: err.message });
  }
});

router.get(
  '/api/orders/:id',
  [param('id').isUUID().withMessage('Invalid order ID')],
  validate,
  async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) {
        return res.status(401).json({ data: null, message: 'Unauthorized', error: 'Missing x-user-id header' });
      }

      const order = await Order.findByIdWithItems(req.params.id);
      if (!order) {
        return res.status(404).json({ data: null, message: 'Order not found', error: null });
      }

      if (order.user_id !== userId) {
        return res.status(403).json({ data: null, message: 'Forbidden', error: 'You do not own this order' });
      }

      res.json({ data: order, message: 'Order retrieved', error: null });
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to fetch order');
      res.status(500).json({ data: null, message: 'Internal server error', error: err.message });
    }
  }
);

router.patch(
  '/api/orders/:id/cancel',
  [param('id').isUUID().withMessage('Invalid order ID')],
  validate,
  async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) {
        return res.status(401).json({ data: null, message: 'Unauthorized', error: 'Missing x-user-id header' });
      }

      const order = await Order.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ data: null, message: 'Order not found', error: null });
      }

      if (order.user_id !== userId) {
        return res.status(403).json({ data: null, message: 'Forbidden', error: 'You do not own this order' });
      }

      if (order.status !== 'pending') {
        return res.status(400).json({
          data: null,
          message: 'Cannot cancel order',
          error: `Order status is '${order.status}', only pending orders can be cancelled`
        });
      }

      const updated = await Order.updateStatus(req.params.id, 'cancelled');
      logger.info({ orderId: req.params.id, userId }, 'Order cancelled');

      res.json({ data: updated, message: 'Order cancelled', error: null });
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to cancel order');
      res.status(500).json({ data: null, message: 'Internal server error', error: err.message });
    }
  }
);

module.exports = router;
