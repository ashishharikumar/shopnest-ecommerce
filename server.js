require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const secret = process.env.JWT_SECRET || 'development_only_change_me';
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, email: { type: String, unique: true, required: true, lowercase: true },
  password: { type: String, required: true }, role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true });
const productSchema = new mongoose.Schema({
  name: { type: String, required: true }, price: { type: Number, required: true }, category: String, image: String,
  description: String, stock: { type: Number, default: 0 }, featured: { type: Boolean, default: false }
}, { timestamps: true });
const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, items: [{ product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, name: String, price: Number, quantity: Number }],
  total: Number, shipping: { fullName: String, phone: String, address: String, city: String, postalCode: String },
  paymentMethod: { type: String, default: 'Cash on Delivery' }, status: { type: String, enum: ['Placed', 'Processing', 'Shipped', 'Delivered'], default: 'Placed' }
}, { timestamps: true });
const User = mongoose.model('User', userSchema), Product = mongoose.model('Product', productSchema), Order = mongoose.model('Order', orderSchema);
const tokenFor = u => jwt.sign({ id: u._id, role: u.role }, secret, { expiresIn: '7d' });
const auth = (admin = false) => (req, res, next) => {
  try { const d = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), secret); if (admin && d.role !== 'admin') return res.status(403).json({ message: 'Admin access required' }); req.user = d; next(); }
  catch { res.status(401).json({ message: 'Please sign in to continue' }); }
};

app.post('/api/auth/register', async (req, res) => {
  try { const { name, email, password } = req.body; if (!name || !email || !password || password.length < 6) return res.status(400).json({ message: 'Name, email and a 6+ character password are required' });
    const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) }); res.status(201).json({ token: tokenFor(user), user: { name: user.name, email: user.email, role: user.role } });
  } catch (e) { res.status(400).json({ message: e.code === 11000 ? 'This email is already registered' : 'Unable to create account' }); }
});
app.post('/api/auth/login', async (req, res) => { const u = await User.findOne({ email: (req.body.email || '').toLowerCase() }); if (!u || !await bcrypt.compare(req.body.password || '', u.password)) return res.status(401).json({ message: 'Invalid email or password' }); res.json({ token: tokenFor(u), user: { name: u.name, email: u.email, role: u.role } }); });
app.get('/api/products', async (req, res) => { const query = req.query.search ? { name: new RegExp(req.query.search, 'i') } : {}; res.json(await Product.find(query).sort({ createdAt: -1 })); });
app.get('/api/products/:id', async (req, res) => { const p = await Product.findById(req.params.id); p ? res.json(p) : res.status(404).json({ message: 'Product not found' }); });
app.post('/api/products', auth(true), async (req, res) => res.status(201).json(await Product.create(req.body)));
app.put('/api/products/:id', auth(true), async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })));
app.delete('/api/products/:id', auth(true), async (req, res) => { await Product.findByIdAndDelete(req.params.id); res.json({ message: 'Product deleted' }); });
app.post('/api/orders', auth(), async (req, res) => { const { items, shipping } = req.body; if (!items?.length || !shipping?.fullName || !shipping?.address || !shipping?.phone) return res.status(400).json({ message: 'Complete your cart and delivery details' }); const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0); const order = await Order.create({ user: req.user.id, items, total, shipping }); res.status(201).json(order); });
app.get('/api/orders/mine', auth(), async (req, res) => res.json(await Order.find({ user: req.user.id }).sort({ createdAt: -1 })));
app.get('/api/admin/stats', auth(true), async (req, res) => res.json({ products: await Product.countDocuments(), customers: await User.countDocuments({ role: 'user' }), orders: await Order.countDocuments(), revenue: (await Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]))[0]?.total || 0 }));
app.get('/api/admin/orders', auth(true), async (req, res) => res.json(await Order.find().populate('user', 'name email').sort({ createdAt: -1 })));
app.patch('/api/admin/orders/:id', auth(true), async (req, res) => res.json(await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true })));
app.get('/api/admin/customers', auth(true), async (req, res) => res.json(await User.find({ role: 'user' }).select('-password').sort({ createdAt: -1 })));

async function seed() { if (await User.countDocuments({ role: 'admin' }) === 0) await User.create({ name: 'ShopNest Admin', email: 'admin@shopnest.com', password: await bcrypt.hash('admin123', 10), role: 'admin' }); if (await Product.countDocuments() === 0) await Product.insertMany([{ name: 'Modern Wireless Headphones', price: 2499, category: 'Electronics', stock: 18, featured: true, image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80', description: 'Immersive sound with all-day comfort.' }, { name: 'Minimal Leather Watch', price: 1899, category: 'Accessories', stock: 25, featured: true, image: 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=600&q=80', description: 'A timeless everyday essential.' }, { name: 'Urban Travel Backpack', price: 1599, category: 'Lifestyle', stock: 12, image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80', description: 'Organized, durable and ready to go.' }, { name: 'Ceramic Table Lamp', price: 1199, category: 'Home', stock: 20, image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80', description: 'Warm, gentle light for your space.' }]); }
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/shopnest').then(async () => { await seed(); app.listen(PORT, () => console.log(`ShopNest running at http://localhost:${PORT}`)); }).catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
