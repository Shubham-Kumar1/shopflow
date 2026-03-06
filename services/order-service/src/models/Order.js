const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        total_amount DECIMAL(10,2) NOT NULL,
        shipping_address JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        product_id VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL
      );
    `);

    logger.info('Database tables initialized');
  } finally {
    client.release();
  }
}

async function create(userId, totalAmount, shippingAddress) {
  const result = await pool.query(
    `INSERT INTO orders (user_id, total_amount, shipping_address)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, totalAmount, JSON.stringify(shippingAddress)]
  );
  return result.rows[0];
}

async function addItems(orderId, items) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = [];
    for (const item of items) {
      const result = await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [orderId, item.productId, item.productName, item.quantity, item.unitPrice]
      );
      inserted.push(result.rows[0]);
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findByUserId(userId) {
  const result = await pool.query(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  const orders = result.rows;
  for (const order of orders) {
    const itemsResult = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [order.id]
    );
    order.items = itemsResult.rows;
  }
  return orders;
}

async function findById(orderId) {
  const result = await pool.query(
    'SELECT * FROM orders WHERE id = $1',
    [orderId]
  );
  return result.rows[0];
}

async function findByIdWithItems(orderId) {
  const order = await findById(orderId);
  if (!order) return null;

  const itemsResult = await pool.query(
    'SELECT * FROM order_items WHERE order_id = $1',
    [orderId]
  );
  order.items = itemsResult.rows;
  return order;
}

async function updateStatus(orderId, status) {
  const result = await pool.query(
    `UPDATE orders SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, orderId]
  );
  return result.rows[0];
}

module.exports = {
  pool,
  init,
  create,
  addItems,
  findByUserId,
  findById,
  findByIdWithItems,
  updateStatus
};
