const express = require('express');
const { body } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');

const User = require('../models/User');
const validate = require('../middleware/validate');
const logger = require('../utils/logger');

const router = express.Router();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));

(async () => {
  await redisClient.connect();
  logger.info('Redis connected (user-service)');
})();

function generateAccessToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post(
  '/api/users/register',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').optional().trim().isLength({ max: 100 }),
    body('lastName').optional().trim().isLength({ max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;

      const existing = await User.findByEmail(email);
      if (existing) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({ email, passwordHash, firstName, lastName });

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      await redisClient.set(`refresh:${user.id}`, refreshToken, { EX: 7 * 24 * 60 * 60 });

      logger.info('User registered', { userId: user.id, email });
      res.status(201).json({
        data: { user, accessToken, refreshToken },
        message: 'User registered successfully',
      });
    } catch (err) {
      logger.error('Registration failed', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/api/users/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      const user = await User.findByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      await redisClient.set(`refresh:${user.id}`, refreshToken, { EX: 7 * 24 * 60 * 60 });

      logger.info('User logged in', { userId: user.id, email });
      res.json({
        data: {
          user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role },
          accessToken,
          refreshToken,
        },
        message: 'Login successful',
      });
    } catch (err) {
      logger.error('Login failed', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.get('/api/users/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ data: user, message: 'Profile retrieved' });
  } catch (err) {
    logger.error('Get profile failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/users/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { firstName, lastName } = req.body;
    const user = await User.update(userId, { firstName, lastName });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info('Profile updated', { userId });
    res.json({ data: user, message: 'Profile updated' });
  } catch (err) {
    logger.error('Update profile failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/api/users/refresh',
  [
    body('refreshToken').notEmpty().withMessage('Refresh token is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { refreshToken } = req.body;

      const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
      const stored = await redisClient.get(`refresh:${decoded.userId}`);

      if (!stored || stored !== refreshToken) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      const accessToken = generateAccessToken(decoded);
      res.json({ data: { accessToken }, message: 'Token refreshed' });
    } catch (err) {
      logger.warn('Token refresh failed', { error: err.message });
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  }
);

module.exports = { router, redisClient };
