const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        user_id UUID NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_method VARCHAR(50),
        stripe_payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    logger.info('Payments table initialized');
  } finally {
    client.release();
  }
}

async function create(orderId, userId, amount, paymentMethod) {
  const result = await pool.query(
    `INSERT INTO payments (order_id, user_id, amount, payment_method)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [orderId, userId, amount, paymentMethod]
  );
  return result.rows[0];
}

async function findByOrderId(orderId) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC',
    [orderId]
  );
  return result.rows[0];
}

async function updateStatus(id, status, stripePaymentId = null) {
  const result = await pool.query(
    `UPDATE payments SET status = $1, stripe_payment_id = COALESCE($2, stripe_payment_id), updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, stripePaymentId, id]
  );
  return result.rows[0];
}

module.exports = {
  pool,
  init,
  create,
  findByOrderId,
  updateStatus
};
