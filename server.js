require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'snaptor-secret-key-change-in-production';

const app = express();

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.businessId = decoded.businessId;
    req.businessSlug = decoded.slug;
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
app.use(express.static('public'));

// MongoDB connection
let db;
const client = new MongoClient(process.env.MONGODB_URI);

async function connectDB() {
  await client.connect();
  db = client.db('picktime');
  // Create indexes
  await db.collection('businesses').createIndex({ slug: 1 }, { unique: true });
  await db.collection('appointments').createIndex({ businessId: 1, date: 1 });
  await db.collection('customers').createIndex({ businessId: 1, phone: 1 });
  await db.collection('customers').createIndex({ businessId: 1, lastVisit: -1 });
  await db.collection('tasks').createIndex({ businessId: 1, completed: 1 });
  console.log('Connected to MongoDB');
}

// Helper: get business by slug
async function getBusinessBySlug(slug) {
  return db.collection('businesses').findOne({ slug });
}

// ============ AUTH ============

// Login by phone
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    const business = await db.collection('businesses').findOne({ phone });
    if (!business) return res.json({ exists: false });
    const token = jwt.sign({ businessId: business._id.toString(), slug: business.slug }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ exists: true, token, business });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user's business
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.businessId) });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json(business);
  } catch (err) {
    console.error('Auth me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update business by slug (protected)
app.put('/api/businesses/:slug', async (req, res) => {
  try {
    const { name, type, phone, email, theme, customization, workingHours, services } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (type !== undefined) update.type = type;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (theme !== undefined) update.theme = theme;
    if (customization !== undefined) update.customization = customization;
    if (workingHours !== undefined) update.workingHours = workingHours;
    if (services !== undefined) update.services = services.map(s => ({ ...s, _id: s._id ? new ObjectId(s._id) : new ObjectId() }));

    const result = await db.collection('businesses').findOneAndUpdate(
      { slug: req.params.slug },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.json(result);
  } catch (err) {
    console.error('Update business by slug error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ BUSINESSES ============

// Create business
app.post('/api/businesses', async (req, res) => {
  try {
    const { name, slug, type, phone, email, theme, workingHours, services } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });

    const existing = await db.collection('businesses').findOne({ slug });
    if (existing) return res.status(409).json({ error: 'Slug already taken' });

    const business = {
      name,
      slug: slug.toLowerCase(),
      type: type || 'general',
      phone: phone || '',
      email: email || '',
      theme: theme || 'default',
      customization: { colors: {} },
      workingHours: workingHours || {
        sunday: { start: '09:00', end: '18:00', enabled: true },
        monday: { start: '09:00', end: '18:00', enabled: true },
        tuesday: { start: '09:00', end: '18:00', enabled: true },
        wednesday: { start: '09:00', end: '18:00', enabled: true },
        thursday: { start: '09:00', end: '18:00', enabled: true },
        friday: { start: '09:00', end: '14:00', enabled: true },
        saturday: { start: '00:00', end: '00:00', enabled: false }
      },
      services: (services || []).map(s => ({ ...s, _id: new ObjectId() })),
      isActive: true,
      createdAt: new Date()
    };

    const result = await db.collection('businesses').insertOne(business);
    business._id = result.insertedId;
    const token = jwt.sign({ businessId: business._id.toString(), slug: business.slug }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ ...business, token });
  } catch (err) {
    console.error('Create business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get business by slug
app.get('/api/businesses/:slug', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json(business);
  } catch (err) {
    console.error('Get business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update business
app.put('/api/businesses/:id', async (req, res) => {
  try {
    const { name, type, phone, email, theme, customization, workingHours } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (type !== undefined) update.type = type;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (theme !== undefined) update.theme = theme;
    if (customization !== undefined) update.customization = customization;
    if (workingHours !== undefined) update.workingHours = workingHours;

    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.json(result);
  } catch (err) {
    console.error('Update business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check username availability
app.get('/api/check-username/:username', async (req, res) => {
  try {
    const existing = await db.collection('businesses').findOne({ slug: req.params.username.toLowerCase() });
    res.json({ available: !existing, username: req.params.username.toLowerCase() });
  } catch (err) {
    console.error('Check username error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ SERVICES ============

// List services
app.get('/api/businesses/:slug/services', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json(business.services || []);
  } catch (err) {
    console.error('List services error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add service
app.post('/api/businesses/:slug/services', async (req, res) => {
  try {
    const { name, duration, price, currency } = req.body;
    if (!name || !duration) return res.status(400).json({ error: 'Name and duration are required' });

    const service = {
      _id: new ObjectId(),
      name,
      duration: Number(duration),
      price: Number(price) || 0,
      currency: currency || 'ILS'
    };

    const result = await db.collection('businesses').findOneAndUpdate(
      { slug: req.params.slug },
      { $push: { services: service } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.status(201).json(service);
  } catch (err) {
    console.error('Add service error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update service
app.put('/api/businesses/:slug/services/:id', async (req, res) => {
  try {
    const { name, duration, price, currency } = req.body;
    const update = {};
    if (name !== undefined) update['services.$.name'] = name;
    if (duration !== undefined) update['services.$.duration'] = Number(duration);
    if (price !== undefined) update['services.$.price'] = Number(price);
    if (currency !== undefined) update['services.$.currency'] = currency;

    const result = await db.collection('businesses').findOneAndUpdate(
      { slug: req.params.slug, 'services._id': new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business or service not found' });
    const svc = result.services.find(s => s._id.toString() === req.params.id);
    res.json(svc);
  } catch (err) {
    console.error('Update service error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete service
app.delete('/api/businesses/:slug/services/:id', async (req, res) => {
  try {
    const result = await db.collection('businesses').findOneAndUpdate(
      { slug: req.params.slug },
      { $pull: { services: { _id: new ObjectId(req.params.id) } } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete service error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ APPOINTMENTS ============

// List appointments (with date range filter)
app.get('/api/businesses/:slug/appointments', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const query = { businessId: business._id };
    if (req.query.date) {
      query.date = req.query.date;
    } else {
      if (req.query.from) query.date = { $gte: req.query.from };
      if (req.query.to) query.date = { ...(query.date || {}), $lte: req.query.to };
    }
    if (req.query.status) query.status = req.query.status;

    const appointments = await db.collection('appointments')
      .find(query)
      .toArray();
    // Sort in JS (CosmosDB doesn't support multi-field sort without composite index)
    appointments.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    res.json(appointments);
  } catch (err) {
    console.error('List appointments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Book appointment
app.post('/api/businesses/:slug/appointments', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const { serviceId, customerName, customerPhone, customerEmail, date, startTime, notes } = req.body;
    if (!customerName || !customerPhone || !date || !startTime || !serviceId) {
      return res.status(400).json({ error: 'Missing required fields: customerName, customerPhone, date, startTime, serviceId' });
    }

    // Find service to get duration - support both _id match and numeric index
    let service = business.services.find(s => s._id && s._id.toString() === serviceId);
    if (!service && !isNaN(serviceId)) {
      service = business.services[parseInt(serviceId)];
    }
    if (!service && business.services.length > 0) {
      // Try matching by name as fallback
      service = business.services.find(s => s.name === serviceId);
    }
    if (!service) return res.status(400).json({ error: 'Service not found' });

    // Calculate end time
    const [h, m] = startTime.split(':').map(Number);
    const endMinutes = h * 60 + m + service.duration;
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    // Check for conflicts
    const conflict = await db.collection('appointments').findOne({
      businessId: business._id,
      date,
      status: { $ne: 'cancelled' },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    });
    if (conflict) return res.status(409).json({ error: 'Time slot already booked' });

    const appointment = {
      businessId: business._id,
      serviceId: service._id || serviceId,
      serviceName: service.name,
      customerName,
      customerPhone,
      customerEmail: customerEmail || '',
      date,
      startTime,
      endTime,
      status: 'pending',
      notes: notes || '',
      createdAt: new Date()
    };

    const result = await db.collection('appointments').insertOne(appointment);
    appointment._id = result.insertedId;

    // Auto-create or update customer
    const existingCustomer = await db.collection('customers').findOne({
      businessId: business._id.toString(),
      phone: customerPhone,
    });
    if (existingCustomer) {
      await db.collection('customers').updateOne(
        { _id: existingCustomer._id },
        { $set: { lastVisit: new Date(), name: customerName }, $inc: { totalVisits: 1, totalSpent: service.price || 0 } }
      );
    } else {
      await db.collection('customers').insertOne({
        businessId: business._id.toString(),
        name: customerName,
        phone: customerPhone,
        email: customerEmail || '',
        notes: '',
        isVip: false,
        tags: [],
        totalVisits: 1,
        totalSpent: service.price || 0,
        lastVisit: new Date(),
        birthday: '',
        createdAt: new Date(),
      });
    }

    res.status(201).json(appointment);
  } catch (err) {
    console.error('Book appointment error:', err.message);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// Update appointment status (confirm/decline/cancel with notes)
app.put('/api/businesses/:slug/appointments/:id', async (req, res) => {
  try {
    const { status, notes, confirmationNote, cancellationReason } = req.body;
    const update = {};
    if (status) update.status = status;
    if (notes !== undefined) update.notes = notes;
    if (confirmationNote !== undefined) update.confirmationNote = confirmationNote;
    if (cancellationReason !== undefined) update.cancellationReason = cancellationReason;

    const result = await db.collection('appointments').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Appointment not found' });
    res.json(result);
  } catch (err) {
    console.error('Update appointment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel appointment
app.delete('/api/businesses/:slug/appointments/:id', async (req, res) => {
  try {
    const { cancellationReason } = req.body || {};
    const update = { status: 'cancelled' };
    if (cancellationReason) update.cancellationReason = cancellationReason;

    const result = await db.collection('appointments').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ success: true, appointment: result });
  } catch (err) {
    console.error('Cancel appointment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ RESCHEDULE ============

// Request reschedule
app.post('/api/businesses/:slug/appointments/:id/reschedule', async (req, res) => {
  try {
    const { requestedDate, requestedTime, reason } = req.body;
    if (!requestedDate || !requestedTime) {
      return res.status(400).json({ error: 'requestedDate and requestedTime are required' });
    }

    const rescheduleRequest = {
      _id: new ObjectId(),
      requestedDate,
      requestedTime,
      reason: reason || '',
      status: 'pending',
      createdAt: new Date()
    };

    const result = await db.collection('appointments').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { status: 'reschedule_requested', rescheduleRequest }
      },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Appointment not found' });
    res.json(result);
  } catch (err) {
    console.error('Reschedule request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept/decline reschedule
app.put('/api/businesses/:slug/appointments/:id/reschedule/:requestId', async (req, res) => {
  try {
    const { action } = req.body; // 'accept' or 'decline'
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'action must be accept or decline' });
    }

    const appointment = await db.collection('appointments').findOne({ _id: new ObjectId(req.params.id) });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    let update;
    if (action === 'accept') {
      // Move to new date/time
      update = {
        $set: {
          date: appointment.rescheduleRequest.requestedDate,
          startTime: appointment.rescheduleRequest.requestedTime,
          status: 'confirmed',
          'rescheduleRequest.status': 'accepted'
        }
      };
    } else {
      update = {
        $set: {
          status: 'confirmed',
          'rescheduleRequest.status': 'declined'
        }
      };
    }

    const result = await db.collection('appointments').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      update,
      { returnDocument: 'after' }
    );
    res.json(result);
  } catch (err) {
    console.error('Reschedule response error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ ANNOUNCEMENTS ============

// Get announcements
app.get('/api/businesses/:slug/announcements', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const announcements = await db.collection('announcements')
      .find({ businessId: { $in: [business._id, business._id.toString()] }, isActive: true })
      .toArray();
    announcements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(announcements);
  } catch (err) {
    console.error('Get announcements error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// Create announcement
app.post('/api/businesses/:slug/announcements', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const announcement = {
      businessId: business._id,
      message,
      isActive: true,
      createdAt: new Date()
    };

    const result = await db.collection('announcements').insertOne(announcement);
    announcement._id = result.insertedId;
    res.status(201).json(announcement);
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete announcement
app.delete('/api/businesses/:slug/announcements/:id', async (req, res) => {
  try {
    const result = await db.collection('announcements').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { isActive: false } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Announcement not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete announcement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ CUSTOMERS ============

// List customers
app.get('/api/businesses/:slug/customers', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const query = { businessId: business._id.toString() };
    const { filter, search } = req.query;

    const now = new Date();
    if (filter === 'recent') {
      const thirtyDaysAgo = new Date(now - 30 * 86400000);
      query.lastVisit = { $gte: thirtyDaysAgo };
    } else if (filter === 'new') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      query.createdAt = { $gte: monthStart };
    } else if (filter === 'inactive') {
      const threeMonthsAgo = new Date(now - 90 * 86400000);
      query.$or = [{ lastVisit: { $lt: threeMonthsAgo } }, { lastVisit: null }];
    } else if (filter === 'vip') {
      query.isVip = true;
    } else if (filter === 'birthdays') {
      const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      query.birthday = mmdd;
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ name: regex }, { phone: regex }];
    }

    const customers = await db.collection('customers')
      .find(query)
      .toArray();
    customers.sort((a, b) => new Date(b.lastVisit || 0) - new Date(a.lastVisit || 0));
    res.json(customers);
  } catch (err) {
    console.error('List customers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Customer groups with counts
app.get('/api/businesses/:slug/customers/groups', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const bid = business._id.toString();
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000);
    const threeMonthsAgo = new Date(now - 90 * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const [all, recent, inactive, newC, vip, birthdays] = await Promise.all([
      db.collection('customers').countDocuments({ businessId: bid }),
      db.collection('customers').countDocuments({ businessId: bid, lastVisit: { $gte: thirtyDaysAgo } }),
      db.collection('customers').countDocuments({ businessId: bid, $or: [{ lastVisit: { $lt: threeMonthsAgo } }, { lastVisit: null }] }),
      db.collection('customers').countDocuments({ businessId: bid, createdAt: { $gte: monthStart } }),
      db.collection('customers').countDocuments({ businessId: bid, isVip: true }),
      db.collection('customers').countDocuments({ businessId: bid, birthday: mmdd }),
    ]);

    // Count recent cancellations
    const cancelled = await db.collection('appointments').countDocuments({
      businessId: business._id, status: 'cancelled',
      date: { $gte: new Date(now - 30 * 86400000).toISOString().split('T')[0] }
    });

    res.json([
      { name: 'All Customers', key: 'all', count: all, icon: 'users' },
      { name: 'Recent', key: 'recent', count: recent, icon: 'calendar' },
      { name: 'Cancelled', key: 'cancelled', count: cancelled, icon: 'x-circle' },
      { name: 'Inactive', key: 'inactive', count: inactive, icon: 'user' },
      { name: 'New', key: 'new', count: newC, icon: 'star' },
      { name: 'VIP', key: 'vip', count: vip, icon: 'star' },
    ]);
  } catch (err) {
    console.error('Customer groups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create customer
app.post('/api/businesses/:slug/customers', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const { name, phone, email, notes, birthday } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });

    const customer = {
      businessId: business._id.toString(),
      name,
      phone,
      email: email || '',
      notes: notes || '',
      isVip: false,
      tags: [],
      totalVisits: 0,
      totalSpent: 0,
      lastVisit: null,
      birthday: birthday || '',
      createdAt: new Date(),
    };

    const result = await db.collection('customers').insertOne(customer);
    customer._id = result.insertedId;
    res.status(201).json(customer);
  } catch (err) {
    console.error('Create customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get customer with visit history
app.get('/api/businesses/:slug/customers/:id', async (req, res) => {
  try {
    const customer = await db.collection('customers').findOne({ _id: new ObjectId(req.params.id) });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Get visit history (past appointments for this customer phone)
    const business = await getBusinessBySlug(req.params.slug);
    const visits = await db.collection('appointments')
      .find({ businessId: business._id, customerPhone: customer.phone, status: { $in: ['confirmed', 'completed'] } })
      .toArray();
    visits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const limitedVisits = visits.slice(0, 50);

    res.json({ ...customer, visits: limitedVisits });
  } catch (err) {
    console.error('Get customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update customer
app.put('/api/businesses/:slug/customers/:id', async (req, res) => {
  try {
    const { name, phone, email, notes, isVip, tags, birthday } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (notes !== undefined) update.notes = notes;
    if (isVip !== undefined) update.isVip = isVip;
    if (tags !== undefined) update.tags = tags;
    if (birthday !== undefined) update.birthday = birthday;

    const result = await db.collection('customers').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Customer not found' });
    res.json(result);
  } catch (err) {
    console.error('Update customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ TASKS ============

// List tasks
app.get('/api/businesses/:slug/tasks', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const query = { businessId: business._id.toString() };
    if (req.query.filter === 'active') query.completed = false;
    else if (req.query.filter === 'completed') query.completed = true;

    const tasks = await db.collection('tasks')
      .find(query)
      .toArray();
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(tasks);
  } catch (err) {
    console.error('List tasks error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// Create task
app.post('/api/businesses/:slug/tasks', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const { text, dueDate } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const task = {
      businessId: business._id.toString(),
      text,
      dueDate: dueDate || null,
      completed: false,
      completedAt: null,
      createdAt: new Date(),
    };

    const result = await db.collection('tasks').insertOne(task);
    task._id = result.insertedId;
    res.status(201).json(task);
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update task
app.put('/api/businesses/:slug/tasks/:id', async (req, res) => {
  try {
    const { text, dueDate, completed } = req.body;
    const update = {};
    if (text !== undefined) update.text = text;
    if (dueDate !== undefined) update.dueDate = dueDate;
    if (completed !== undefined) {
      update.completed = completed;
      update.completedAt = completed ? new Date() : null;
    }

    const result = await db.collection('tasks').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Task not found' });
    res.json(result);
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete task
app.delete('/api/businesses/:slug/tasks/:id', async (req, res) => {
  try {
    const result = await db.collection('tasks').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ AVAILABILITY ============

app.get('/api/businesses/:slug/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date parameter required (YYYY-MM-DD)' });

    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    // Get day of week
    const dayOfWeek = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const hours = business.workingHours?.[dayOfWeek];

    if (!hours || !hours.enabled) {
      return res.json({ date, available: false, slots: [], message: 'Business closed on this day' });
    }

    // Get existing appointments for this date
    const appointments = await db.collection('appointments')
      .find({ businessId: business._id, date, status: { $nin: ['cancelled'] } })
      .toArray();

    // Generate 30-minute slots
    const [startH, startM] = hours.start.split(':').map(Number);
    const [endH, endM] = hours.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const slotDuration = 30;

    const slots = [];
    for (let m = startMinutes; m + slotDuration <= endMinutes; m += slotDuration) {
      const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const slotEnd = `${String(Math.floor((m + slotDuration) / 60)).padStart(2, '0')}:${String((m + slotDuration) % 60).padStart(2, '0')}`;

      const isBooked = appointments.some(apt =>
        apt.startTime < slotEnd && apt.endTime > slotStart
      );

      slots.push({ start: slotStart, end: slotEnd, available: !isBooked });
    }

    res.json({ date, dayOfWeek, available: true, slots });
  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ HEALTH CHECK ============
app.get('/api/health', async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Start
const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`PickTime running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});
