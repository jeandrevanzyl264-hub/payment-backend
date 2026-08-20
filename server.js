const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = express();

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`📡 Incoming traffic: ${req.method} ${req.url}`);
  next();
});

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_b4bc4bc545029d23f829c12977446ec5010968a8';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://jeandrevanzyl264_db_user:25FzusFWg759EYxb@vanzyldevelopers.nnlid44.mongodb.net/payment-db?retryWrites=true&w=majority&appName=VANZYLDEVELOPERS';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB!'))
  .catch(err => console.error('❌ Database Connection Failed:', err));

const orderSchema = new mongoose.Schema({
  email: String,
  packageName: String,
  amount: Number,
  reference: String,
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

// Initialize Checkout with dynamic packages
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { packageType } = req.body;

    // Define packages in South African Cents (ZAR)
    const packageCatalog = {
      starter: { name: "Starter Package", amount: 150000 },       // R1,500.00
      pro: { name: "Professional Package", amount: 500000 },      // R5,000.00
      enterprise: { name: "Enterprise Package", amount: 1200000 } // R12,000.00
    };

    const selected = packageCatalog[packageType] || packageCatalog.pro;
    const customerEmail = "customer@example.com"; 

    const newOrder = new Order({
      email: customerEmail,
      packageName: selected.name,
      amount: selected.amount / 100
    });

    const savedOrder = await newOrder.save();

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: selected.amount,
        currency: "ZAR",
        callback_url: `https://vanzyl-payment-backend.onrender.com/verify-payment`
      })
    });

    const data = await response.json();

    if (data.status) {
      savedOrder.reference = data.data.reference;
      await savedOrder.save();
      res.redirect(303, data.data.authorization_url);
    } else {
      res.status(400).send(`Payment Initialization Failed: ${data.message}`);
    }
  } catch (error) {
    console.error('❌ Server Error:', error);
    res.status(500).send("Internal Server Error");
  }
});

// Verify Payment Status
app.get('/verify-payment', async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.status(400).send("No reference provided.");

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` }
    });

    const data = await response.json();

    if (data.status && data.data.status === 'success') {
      const order = await Order.findOne({ reference: reference });
      if (order) {
        order.status = 'Paid';
        await order.save();
      }
      res.redirect('https://vanzyldevelopers.online/success.html');
    } else {
      res.redirect('https://vanzyldevelopers.online/cancel.html');
    }
  } catch (error) {
    res.status(500).send("Error verifying payment");
  }
});

app.post('/paystack-webhook', async (req, res) => {
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash === req.headers['x-paystack-signature']) {
    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const order = await Order.findOne({ reference: reference });
      if (order && order.status !== 'Paid') {
        order.status = 'Paid';
        await order.save();
      }
    }
  }
  res.sendStatus(200);
});

app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));