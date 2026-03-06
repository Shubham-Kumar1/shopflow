const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  description: String,
  price: { type: Number, required: true, min: 0 },
  category: { type: String, required: true, index: true },
  stock: { type: Number, default: 0, min: 0 },
  images: [String],
  sku: { type: String, unique: true },
  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

productSchema.index({ name: 'text' });

module.exports = mongoose.model('Product', productSchema);
