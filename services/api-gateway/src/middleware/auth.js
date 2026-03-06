const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const PUBLIC_ROUTES = [
  { method: 'POST', path: '/api/users/register' },
  { method: 'POST', path: '/api/users/login' },
  { method: 'POST', path: '/api/users/refresh' },
  { method: 'POST', path: '/api/payments/webhook' },
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/metrics' },
];

function isPublicRoute(method, path) {
  for (const route of PUBLIC_ROUTES) {
    if (route.method === method && path === route.path) return true;
  }

  if (method === 'GET' && (path === '/api/products' || path.startsWith('/api/products/'))) {
    return true;
  }

  return false;
}

function authMiddleware(req, res, next) {
  const path = req.originalUrl.split('?')[0];
  if (isPublicRoute(req.method, path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.headers['x-user-id'] = decoded.userId;
    req.headers['x-user-role'] = decoded.role;
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: err.message });
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = authMiddleware;
