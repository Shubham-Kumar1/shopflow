require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('./models/Product');
const logger = require('./utils/logger');

const products = [
  // Electronics
  { name: 'Wireless Bluetooth Headphones', description: 'Premium noise-cancelling over-ear headphones with 30-hour battery life', price: 89.99, category: 'Electronics', stock: 75, sku: 'ELEC-001', images: [] },
  { name: '4K Ultra HD Monitor 27"', description: 'IPS panel with HDR support, 144Hz refresh rate, USB-C connectivity', price: 449.99, category: 'Electronics', stock: 30, sku: 'ELEC-002', images: [] },
  { name: 'Mechanical Keyboard RGB', description: 'Cherry MX Brown switches, aluminum frame, per-key RGB backlighting', price: 129.99, category: 'Electronics', stock: 50, sku: 'ELEC-003', images: [] },
  { name: 'Portable SSD 1TB', description: 'USB 3.2 Gen 2 external solid state drive, up to 1050MB/s read speed', price: 79.99, category: 'Electronics', stock: 100, sku: 'ELEC-004', images: [] },
  { name: 'Smart Fitness Tracker', description: 'Heart rate monitoring, GPS, sleep tracking, 7-day battery life', price: 59.99, category: 'Electronics', stock: 85, sku: 'ELEC-005', images: [] },

  // Clothing
  { name: 'Classic Denim Jacket', description: 'Vintage wash denim jacket with button closure, unisex fit', price: 68.00, category: 'Clothing', stock: 40, sku: 'CLTH-001', images: [] },
  { name: 'Merino Wool Sweater', description: 'Lightweight crew neck sweater, temperature regulating, machine washable', price: 95.00, category: 'Clothing', stock: 55, sku: 'CLTH-002', images: [] },
  { name: 'Running Shoes Pro', description: 'Lightweight mesh upper, responsive cushioning, carbon fiber plate', price: 159.99, category: 'Clothing', stock: 60, sku: 'CLTH-003', images: [] },
  { name: 'Organic Cotton T-Shirt Pack', description: 'Pack of 3 essential crew neck t-shirts, 100% organic cotton', price: 34.99, category: 'Clothing', stock: 90, sku: 'CLTH-004', images: [] },
  { name: 'Waterproof Hiking Boots', description: 'Gore-Tex lining, Vibram sole, ankle support, all-terrain grip', price: 189.99, category: 'Clothing', stock: 35, sku: 'CLTH-005', images: [] },

  // Books
  { name: 'The Art of Clean Code', description: 'A practical guide to writing readable, maintainable software', price: 29.99, category: 'Books', stock: 80, sku: 'BOOK-001', images: [] },
  { name: 'Data Structures & Algorithms', description: 'Comprehensive textbook covering fundamental CS concepts with examples', price: 49.99, category: 'Books', stock: 45, sku: 'BOOK-002', images: [] },
  { name: 'Modern DevOps Practices', description: 'CI/CD, containerization, infrastructure as code, and monitoring', price: 39.99, category: 'Books', stock: 60, sku: 'BOOK-003', images: [] },
  { name: 'Designing Distributed Systems', description: 'Patterns and paradigms for scalable, reliable services', price: 44.99, category: 'Books', stock: 55, sku: 'BOOK-004', images: [] },
  { name: 'The Startup Playbook', description: 'Lessons from building and scaling successful technology companies', price: 24.99, category: 'Books', stock: 70, sku: 'BOOK-005', images: [] },

  // Home & Garden
  { name: 'Smart LED Desk Lamp', description: 'Adjustable color temperature, USB charging port, touch controls', price: 45.99, category: 'Home & Garden', stock: 65, sku: 'HOME-001', images: [] },
  { name: 'Indoor Herb Garden Kit', description: 'Self-watering planter with grow light, includes basil and mint seeds', price: 38.99, category: 'Home & Garden', stock: 50, sku: 'HOME-002', images: [] },
  { name: 'Stainless Steel Cookware Set', description: '10-piece set with tri-ply construction, oven safe to 500°F', price: 199.99, category: 'Home & Garden', stock: 25, sku: 'HOME-003', images: [] },
  { name: 'Robotic Vacuum Cleaner', description: 'LIDAR navigation, 2500Pa suction, app control, auto-empty base', price: 349.99, category: 'Home & Garden', stock: 20, sku: 'HOME-004', images: [] },
  { name: 'Bamboo Bathroom Organizer', description: 'Multi-tier shelf with waterproof coating, easy assembly', price: 54.99, category: 'Home & Garden', stock: 45, sku: 'HOME-005', images: [] },
];

async function seed() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/shopflow_products';
    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB for seeding');

    await Product.deleteMany({});
    logger.info('Cleared existing products');

    const inserted = await Product.insertMany(products);
    logger.info(`Seeded ${inserted.length} products`);

    await mongoose.connection.close();
    logger.info('Seed complete, connection closed');
    process.exit(0);
  } catch (err) {
    logger.error('Seed failed', { error: err.message });
    process.exit(1);
  }
}

seed();
