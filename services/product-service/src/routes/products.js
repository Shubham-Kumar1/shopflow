const express = require('express');
const { body, param, query } = require('express-validator');
const { createClient } = require('redis');

const Product = require('../models/Product');
const logger = require('../utils/logger');

const router = express.Router();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));

(async () => {
  await redisClient.connect();
  logger.info('Redis connected (product-service)');
})();

function requireAdmin(req, res, next) {
  if (req.headers['x-user-role'] !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

router.get('/api/products', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 12));
    const skip = (page - 1) * limit;

    const filter = { isActive: true };

    if (req.query.category) {
      filter.category = req.query.category;
    }

    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseFloat(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseFloat(req.query.maxPrice);
    }

    let sortOption = { createdAt: -1 };
    switch (req.query.sort) {
      case 'price_asc': sortOption = { price: 1 }; break;
      case 'price_desc': sortOption = { price: -1 }; break;
      case 'newest': sortOption = { createdAt: -1 }; break;
    }

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sortOption).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      data: {
        products,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    logger.error('List products failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `product:${id}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json({ data: JSON.parse(cached), message: 'Product retrieved (cached)' });
    }

    const product = await Product.findById(id).lean();
    if (!product || !product.isActive) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await redisClient.set(cacheKey, JSON.stringify(product), { EX: 300 });

    res.json({ data: product, message: 'Product retrieved' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    logger.error('Get product failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/api/products',
  requireAdmin,
  [
    body('name').notEmpty().trim().withMessage('Name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('category').notEmpty().trim().withMessage('Category is required'),
    body('stock').optional().isInt({ min: 0 }),
    body('sku').optional().trim(),
    body('description').optional().trim(),
    body('images').optional().isArray(),
  ],
  async (req, res) => {
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', data: errors.array() });
    }

    try {
      const product = await Product.create(req.body);
      logger.info('Product created', { productId: product._id });
      res.status(201).json({ data: product, message: 'Product created' });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Duplicate SKU' });
      }
      logger.error('Create product failed', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await redisClient.del(`product:${req.params.id}`);

    logger.info('Product updated', { productId: product._id });
    res.json({ data: product, message: 'Product updated' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    logger.error('Update product failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await redisClient.del(`product:${req.params.id}`);

    logger.info('Product soft-deleted', { productId: product._id });
    res.json({ data: product, message: 'Product deleted' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    logger.error('Delete product failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch(
  '/api/products/:id/stock',
  [
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  ],
  async (req, res) => {
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', data: errors.array() });
    }

    try {
      const { quantity } = req.body;

      const product = await Product.findOneAndUpdate(
        { _id: req.params.id, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: true }
      );

      if (!product) {
        return res.status(400).json({ error: 'Insufficient stock or product not found' });
      }

      await redisClient.del(`product:${req.params.id}`);

      logger.info('Stock decremented', { productId: product._id, quantity });
      res.json({ data: product, message: 'Stock updated' });
    } catch (err) {
      if (err.name === 'CastError') {
        return res.status(400).json({ error: 'Invalid product ID' });
      }
      logger.error('Stock update failed', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = { router, redisClient };
