const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

async function init() {
  const query = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      role VARCHAR(50) DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;
  await pool.query(query);
  logger.info('Users table initialized');
}

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT id, email, first_name, last_name, role, created_at, updated_at FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create({ email, passwordHash, firstName, lastName }) {
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id, email, first_name, last_name, role, created_at',
    [email, passwordHash, firstName, lastName]
  );
  return rows[0];
}

async function update(id, { firstName, lastName }) {
  const { rows } = await pool.query(
    'UPDATE users SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name), updated_at = NOW() WHERE id = $3 RETURNING id, email, first_name, last_name, role, created_at, updated_at',
    [firstName, lastName, id]
  );
  return rows[0] || null;
}

module.exports = { pool, init, findByEmail, findById, create, update };
