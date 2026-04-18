require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'snaptor-secret-key-change-in-production';

const app = express();

// ============ SECURITY HELPERS ============

// XSS sanitization
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').replace(/[<>"'&]/g, (c) => {
    return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
  }).trim();
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => typeof v === 'string' ? sanitize(v) : typeof v === 'object' ? sanitizeObject(v) : v);
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') clean[key] = sanitize(val);
    else if (typeof val === 'object' && val !== null) clean[key] = sanitizeObject(val);
    else clean[key] = val;
  }
  return clean;
}

// NoSQL injection prevention
function sanitizeQuery(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[${}]/g, '');
}

// Israeli phone validation
function isValidIsraeliPhone(phone) {
  if (typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(\+972|972|0)(5[0-9]|7[0-9])\d{7}$/.test(cleaned);
}

// Booking tokens (anti-spam)
const bookingTokens = new Map();

function cleanExpiredTokens() {
  const now = Date.now();
  for (const [k, v] of bookingTokens) {
    if (now - v.createdAt > 600000) bookingTokens.delete(k);
  }
}

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

// Ownership verification: ensure authenticated user owns the business slug
async function verifyOwnership(req, res, next) {
  const business = await getBusinessBySlug(req.params.slug);
  if (!business) return res.status(404).json({ error: 'Business not found' });
  if (business._id.toString() !== req.businessId) {
    return res.status(403).json({ error: 'Not authorized for this business' });
  }
  req.business = business;
  next();
}

// Sanitize all POST/PUT bodies
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// ============ RATE LIMITERS ============

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many bookings. Try again later.' },
  keyGenerator: (req) => req.ip
});

const createBusinessLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3,
  message: { error: 'Too many businesses created. Try again tomorrow.' },
  keyGenerator: (req) => req.ip
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' }
});

// ============ MIDDLEWARE ============

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(globalLimiter);
app.use(sanitizeBody);
app.use(express.static('public'));

// MongoDB connection
let db;
const client = new MongoClient(process.env.MONGODB_URI);

async function connectDB() {
  await client.connect();
  db = client.db('picktime');
  await db.collection('businesses').createIndex({ slug: 1 }, { unique: true });
  await db.collection('appointments').createIndex({ businessId: 1, date: 1 });
  await db.collection('customers').createIndex({ businessId: 1, phone: 1 });
  await db.collection('customers').createIndex({ businessId: 1, lastVisit: -1 });
  await db.collection('tasks').createIndex({ businessId: 1, completed: 1 });
  console.log('Connected to MongoDB');
}

// Helper: get business by slug
async function getBusinessBySlug(slug) {
  return db.collection('businesses').findOne({ slug: sanitizeQuery(slug) });
}

// ============ AUTH ============

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { phone, slug } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    const businesses = await db.collection('businesses').find({ phone: sanitizeQuery(phone) }).toArray();
    if (!businesses.length) return res.json({ exists: false });
    const allBusinesses = businesses.map(b => ({ _id: b._id, name: b.name, slug: b.slug, type: b.type }));
    // If multiple businesses and no slug specified, return list for selection (no token)
    if (businesses.length > 1 && !slug) {
      return res.json({ exists: true, businesses: allBusinesses });
    }
    // Single business or slug specified — pick and return token
    let business = slug ? businesses.find(b => b.slug === slug) : businesses[0];
    if (!business) business = businesses[0];
    const token = jwt.sign({ businessId: business._id.toString(), slug: business.slug }, JWT_SECRET, { expiresIn: '30d' });
    // Track last login
    await db.collection('businesses').updateOne({ _id: business._id }, { $set: { lastLogin: new Date() } });
    res.json({ exists: true, token, business, businesses: allBusinesses });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user's full business data (authenticated)
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

// ============ BOOKING TOKEN ============

app.get('/api/businesses/:slug/booking-token', async (req, res) => {
  try {
    const token = crypto.randomBytes(16).toString('hex');
    bookingTokens.set(token, { slug: req.params.slug, createdAt: Date.now(), used: false });
    cleanExpiredTokens();
    res.json({ token });
  } catch (err) {
    console.error('Booking token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ BUSINESSES ============

// Create business (rate limited)
app.post('/api/businesses', createBusinessLimiter, async (req, res) => {
  try {
    const { name, slug, type, phone, email, theme, workingHours, services } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });

    const existing = await db.collection('businesses').findOne({ slug: slug.toLowerCase() });
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

// Get business by slug — PUBLIC (limited fields only)
app.get('/api/businesses/:slug', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    // Return only public fields — NO phone, email, _id, createdAt
    const { name, slug, type, theme, services, workingHours, customization } = business;
    // Include staff (public fields only)
    const publicStaff = (business.staff || []).filter(s => s.isActive !== false).map(s => ({
      _id: s._id, name: s.name, role: s.role, services: s.services || [], workingHours: s.workingHours || {}
    }));
    res.json({
      name, slug, type, theme,
      services: (services || []).map(s => ({ name: s.name, duration: s.duration, price: s.price, _id: s._id })),
      workingHours,
      customization,
      staff: publicStaff
    });
  } catch (err) {
    console.error('Get business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update business by slug — PROTECTED
app.put('/api/businesses/:slug', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    if (business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { name, type, phone, email, theme, customization, workingHours, services, staff } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (type !== undefined) update.type = type;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (theme !== undefined) update.theme = theme;
    if (customization !== undefined) update.customization = customization;
    if (workingHours !== undefined) update.workingHours = workingHours;
    if (services !== undefined) update.services = services.map(s => ({ ...s, _id: s._id ? new ObjectId(s._id) : new ObjectId() }));
    if (staff !== undefined) update.staff = staff.map(s => ({ ...s, _id: s._id ? new ObjectId(s._id) : new ObjectId() }));

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

// Check username availability — PUBLIC
app.get('/api/check-username/:username', async (req, res) => {
  try {
    const existing = await db.collection('businesses').findOne({ slug: sanitizeQuery(req.params.username.toLowerCase()) });
    res.json({ available: !existing, username: req.params.username.toLowerCase() });
  } catch (err) {
    console.error('Check username error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ SERVICES (PROTECTED) ============

app.get('/api/businesses/:slug/services', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json((business.services || []).map(s => ({ name: s.name, duration: s.duration, price: s.price, _id: s._id })));
  } catch (err) {
    console.error('List services error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/businesses/:slug/services', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { name, duration, price, currency } = req.body;
    if (!name || !duration) return res.status(400).json({ error: 'Name and duration are required' });

    const service = { _id: new ObjectId(), name, duration: Number(duration), price: Number(price) || 0, currency: currency || 'ILS' };

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

app.put('/api/businesses/:slug/services/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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

app.delete('/api/businesses/:slug/services/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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

// List appointments — PROTECTED (only owner)
app.get('/api/businesses/:slug/appointments', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    if (business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const query = { businessId: business._id };
    if (req.query.date) {
      query.date = sanitizeQuery(req.query.date);
    } else {
      if (req.query.from) query.date = { $gte: sanitizeQuery(req.query.from) };
      if (req.query.to) query.date = { ...(query.date || {}), $lte: sanitizeQuery(req.query.to) };
    }
    if (req.query.status) query.status = sanitizeQuery(req.query.status);

    const appointments = await db.collection('appointments').find(query).toArray();
    appointments.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    res.json(appointments);
  } catch (err) {
    console.error('List appointments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Book appointment — PUBLIC (with booking token + rate limit)
app.post('/api/businesses/:slug/appointments', bookingLimiter, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    // Check if request is from authenticated business owner
    const { bookingToken, serviceId, staffId, customerName, customerPhone, customerEmail, date, startTime, notes } = req.body;
    const authHeader = req.headers.authorization;
    let isOwner = false;
    if (authHeader) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        if (decoded.slug === req.params.slug) isOwner = true;
      } catch {}
    }

    // Verify booking token only for public (non-owner) bookings
    if (!isOwner) {
      const bt = bookingTokens.get(bookingToken);
      if (!bt || bt.used || bt.slug !== req.params.slug || Date.now() - bt.createdAt > 600000) {
        return res.status(403).json({ error: 'Invalid or expired booking token' });
      }
      bt.used = true;
    }

    if (!customerName || !customerPhone || !date || !startTime || !serviceId) {
      return res.status(400).json({ error: 'Missing required fields: customerName, customerPhone, date, startTime, serviceId' });
    }

    // Validate Israeli phone
    if (!isValidIsraeliPhone(customerPhone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Find service
    let service = business.services.find(s => s._id && s._id.toString() === serviceId);
    if (!service && !isNaN(serviceId)) service = business.services[parseInt(serviceId)];
    if (!service && business.services.length > 0) service = business.services.find(s => s.name === serviceId);
    if (!service) return res.status(400).json({ error: 'Service not found' });

    // Validate per-day service availability
    const dayOfWeek = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const dayHours = business.workingHours?.[dayOfWeek];
    if (dayHours && dayHours.serviceMode === 'custom' && Array.isArray(dayHours.enabledServices)) {
      const svcId = (service._id || serviceId).toString();
      if (!dayHours.enabledServices.some(id => id.toString() === svcId)) {
        return res.status(400).json({ error: 'Service not available on this day' });
      }
    }

    // Validate staff member if provided
    let staffName = '';
    let resolvedStaffId = staffId || '';
    if (staffId && business.staff?.length > 0) {
      const sm = business.staff.find(s => s._id?.toString() === staffId);
      if (!sm) return res.status(400).json({ error: 'Staff member not found' });
      if (sm.isActive === false) return res.status(400).json({ error: 'Staff member is inactive' });
      staffName = sm.name || '';
      const staffHours = sm.workingHours?.[dayOfWeek];
      if (staffHours && !staffHours.enabled) {
        return res.status(400).json({ error: 'Staff member not available on this day' });
      }
      if (sm.services?.length > 0) {
        const svcId = (service._id || serviceId).toString();
        if (!sm.services.includes(svcId) && !sm.services.some(sid => sid.toString() === svcId)) {
          return res.status(400).json({ error: 'Staff member does not provide this service' });
        }
      }
    } else if (business.staff?.length > 0 && !isOwner) {
      return res.status(400).json({ error: 'Staff selection required' });
    }

    // Calculate end time
    const [h, m] = startTime.split(':').map(Number);
    const endMinutes = h * 60 + m + service.duration;
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    // Check for conflicts (scoped to staff if provided)
    const conflictQuery = {
      businessId: business._id,
      date,
      status: { $ne: 'cancelled' },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    };
    if (resolvedStaffId) conflictQuery.staffId = resolvedStaffId;
    const conflict = await db.collection('appointments').findOne(conflictQuery);
    if (conflict) return res.status(409).json({ error: 'Time slot already booked' });

    const appointment = {
      businessId: business._id,
      serviceId: service._id || serviceId,
      serviceName: service.name,
      staffId: resolvedStaffId,
      staffName,
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update appointment — PROTECTED
app.put('/api/businesses/:slug/appointments/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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

// Cancel appointment — PROTECTED
app.delete('/api/businesses/:slug/appointments/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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

// ============ RESCHEDULE (PROTECTED) ============

app.post('/api/businesses/:slug/appointments/:id/reschedule', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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
      { $set: { status: 'reschedule_requested', rescheduleRequest } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Appointment not found' });
    res.json(result);
  } catch (err) {
    console.error('Reschedule request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/businesses/:slug/appointments/:id/reschedule/:requestId', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { action } = req.body;
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'action must be accept or decline' });
    }

    const appointment = await db.collection('appointments').findOne({ _id: new ObjectId(req.params.id) });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    let update;
    if (action === 'accept') {
      update = {
        $set: {
          date: appointment.rescheduleRequest.requestedDate,
          startTime: appointment.rescheduleRequest.requestedTime,
          status: 'confirmed',
          'rescheduleRequest.status': 'accepted'
        }
      };
    } else {
      update = { $set: { status: 'confirmed', 'rescheduleRequest.status': 'declined' } };
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

// Get announcements — PUBLIC
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
    console.error('Get announcements error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create announcement — PROTECTED
app.post('/api/businesses/:slug/announcements', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const announcement = { businessId: business._id, message, isActive: true, createdAt: new Date() };
    const result = await db.collection('announcements').insertOne(announcement);
    announcement._id = result.insertedId;
    res.status(201).json(announcement);
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete announcement — PROTECTED
app.delete('/api/businesses/:slug/announcements/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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

// ============ CUSTOMERS (ALL PROTECTED) ============

app.get('/api/businesses/:slug/customers', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const query = { businessId: business._id.toString() };
    const { filter, search } = req.query;

    const now = new Date();
    if (filter === 'recent') {
      query.lastVisit = { $gte: new Date(now - 30 * 86400000) };
    } else if (filter === 'new') {
      query.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    } else if (filter === 'inactive') {
      query.$or = [{ lastVisit: { $lt: new Date(now - 90 * 86400000) } }, { lastVisit: null }];
    } else if (filter === 'vip') {
      query.isVip = true;
    } else if (filter === 'birthdays') {
      const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      query.birthday = mmdd;
    }

    if (search) {
      const sanitizedSearch = sanitizeQuery(search);
      const regex = new RegExp(sanitizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: regex }, { phone: regex }];
    }

    const customers = await db.collection('customers').find(query).toArray();
    customers.sort((a, b) => new Date(b.lastVisit || 0) - new Date(a.lastVisit || 0));
    res.json(customers);
  } catch (err) {
    console.error('List customers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/businesses/:slug/customers/groups', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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

app.post('/api/businesses/:slug/customers', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { name, phone, email, notes, birthday } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });

    const customer = {
      businessId: business._id.toString(),
      name, phone, email: email || '', notes: notes || '',
      isVip: false, tags: [], totalVisits: 0, totalSpent: 0,
      lastVisit: null, birthday: birthday || '', createdAt: new Date(),
    };

    const result = await db.collection('customers').insertOne(customer);
    customer._id = result.insertedId;
    res.status(201).json(customer);
  } catch (err) {
    console.error('Create customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/businesses/:slug/customers/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(req.params.id) });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const visits = await db.collection('appointments')
      .find({ businessId: business._id, customerPhone: customer.phone, status: { $in: ['confirmed', 'completed'] } })
      .toArray();
    visits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    res.json({ ...customer, visits: visits.slice(0, 50) });
  } catch (err) {
    console.error('Get customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/businesses/:slug/customers/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

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

// ============ TASKS (ALL PROTECTED) ============

app.get('/api/businesses/:slug/tasks', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const query = { businessId: business._id.toString() };
    if (req.query.filter === 'active') query.completed = false;
    else if (req.query.filter === 'completed') query.completed = true;

    const tasks = await db.collection('tasks').find(query).toArray();
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(tasks);
  } catch (err) {
    console.error('List tasks error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/businesses/:slug/tasks', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { text, dueDate } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const task = {
      businessId: business._id.toString(),
      text, dueDate: dueDate || null,
      completed: false, completedAt: null, createdAt: new Date(),
    };

    const result = await db.collection('tasks').insertOne(task);
    task._id = result.insertedId;
    res.status(201).json(task);
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/businesses/:slug/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { text, dueDate, completed } = req.body;
    const update = {};
    if (text !== undefined) update.text = text;
    if (dueDate !== undefined) update.dueDate = dueDate;
    if (completed !== undefined) { update.completed = completed; update.completedAt = completed ? new Date() : null; }

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

app.delete('/api/businesses/:slug/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const result = await db.collection('tasks').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ STAFF (PROTECTED) ============

// Get staff — PUBLIC (for booking flow)
app.get('/api/businesses/:slug/staff', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const staff = (business.staff || []).filter(s => s.isActive !== false);
    res.json(staff.map(s => ({
      _id: s._id, name: s.name, role: s.role, services: s.services || [],
      workingHours: s.workingHours || {}
    })));
  } catch (err) {
    console.error('Get staff error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update staff — PROTECTED
app.put('/api/businesses/:slug/staff', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const { staff } = req.body;
    if (!Array.isArray(staff)) return res.status(400).json({ error: 'staff must be an array' });

    const staffWithIds = staff.map(s => ({
      ...s,
      _id: s._id ? new ObjectId(s._id) : new ObjectId()
    }));

    const result = await db.collection('businesses').findOneAndUpdate(
      { slug: req.params.slug },
      { $set: { staff: staffWithIds } },
      { returnDocument: 'after' }
    );
    res.json(result);
  } catch (err) {
    console.error('Update staff error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ AVAILABILITY (PUBLIC) ============

app.get('/api/businesses/:slug/availability', async (req, res) => {
  try {
    const { date, staffId, serviceId } = req.query;
    if (!date) return res.status(400).json({ error: 'Date parameter required (YYYY-MM-DD)' });

    const sanitizedDate = sanitizeQuery(date);
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const dayOfWeek = new Date(sanitizedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const businessHours = business.workingHours?.[dayOfWeek];

    if (!businessHours || !businessHours.enabled) {
      return res.json({ date: sanitizedDate, available: false, slots: [], availableServices: [], message: 'Business closed on this day' });
    }

    // Determine effective working hours (staff hours override business hours)
    let effectiveStart = businessHours.start;
    let effectiveEnd = businessHours.end;
    let staffMemberFound = null;

    if (staffId && business.staff?.length > 0) {
      staffMemberFound = business.staff.find(s => s._id?.toString() === sanitizeQuery(staffId));
      if (staffMemberFound) {
        const staffHours = staffMemberFound.workingHours?.[dayOfWeek];
        if (!staffHours || !staffHours.enabled) {
          return res.json({ date: sanitizedDate, available: false, slots: [], message: 'Staff member not available on this day' });
        }
        effectiveStart = staffHours.start;
        effectiveEnd = staffHours.end;
      }
    }

    // Per-day service availability
    let availableServiceIds = null;
    if (businessHours.serviceMode === 'custom' && Array.isArray(businessHours.enabledServices)) {
      availableServiceIds = businessHours.enabledServices.map(id => id.toString());
    }

    // If serviceId provided, check it's available on this day
    if (serviceId && availableServiceIds) {
      if (!availableServiceIds.includes(sanitizeQuery(serviceId))) {
        return res.json({ date: sanitizedDate, available: false, slots: [], message: 'Service not available on this day' });
      }
    }

    // Also check if staff provides the requested service
    if (serviceId && staffMemberFound && staffMemberFound.services?.length > 0) {
      if (!staffMemberFound.services.includes(sanitizeQuery(serviceId)) &&
          !staffMemberFound.services.some(sid => sid.toString() === sanitizeQuery(serviceId))) {
        return res.json({ date: sanitizedDate, available: false, slots: [], message: 'Staff member does not provide this service' });
      }
    }

    // Build appointment query — filter by staffId if provided
    const aptQuery = { businessId: business._id, date: sanitizedDate, status: { $nin: ['cancelled'] } };
    if (staffId) aptQuery.staffId = sanitizeQuery(staffId);

    const appointments = await db.collection('appointments')
      .find(aptQuery)
      .toArray();

    const [startH, startM] = effectiveStart.split(':').map(Number);
    const [endH, endM] = effectiveEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    // Use service duration for slot intervals, default 30
    let slotDuration = 30;
    if (serviceId) {
      const svc = (business.services || []).find(s => 
        s._id?.toString() === serviceId || s.name === serviceId
      );
      if (svc && svc.duration) slotDuration = svc.duration;
    }

    const slots = [];
    for (let m = startMinutes; m + slotDuration <= endMinutes; m += slotDuration) {
      const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const slotEnd = `${String(Math.floor((m + slotDuration) / 60)).padStart(2, '0')}:${String((m + slotDuration) % 60).padStart(2, '0')}`;
      const isBooked = appointments.some(apt => apt.startTime < slotEnd && apt.endTime > slotStart);
      slots.push({ start: slotStart, end: slotEnd, available: !isBooked });
    }

    // Build available services for this day
    const availableServices = availableServiceIds
      ? (business.services || []).filter(s => availableServiceIds.includes(s._id?.toString())).map(s => ({ _id: s._id, name: s.name, duration: s.duration, price: s.price }))
      : (business.services || []).map(s => ({ _id: s._id, name: s.name, duration: s.duration, price: s.price }));

    // Build available staff for this day + service
    const availableStaff = (business.staff || []).filter(s => {
      if (s.isActive === false) return false;
      const sh = s.workingHours?.[dayOfWeek];
      if (sh && !sh.enabled) return false;
      if (serviceId && s.services?.length > 0) {
        const sid = sanitizeQuery(serviceId);
        if (!s.services.includes(sid) && !s.services.some(id => id.toString() === sid)) return false;
      }
      return true;
    }).map(s => ({ _id: s._id, name: s.name, role: s.role }));

    res.json({ date: sanitizedDate, dayOfWeek, available: true, slots, availableServices, availableStaff });
  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ STATS (PROTECTED) ============

app.get('/api/businesses/:slug/stats', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });

    const bid = business._id;
    const bidStr = business._id.toString();
    const now = new Date();
    const weekAgoStr = new Date(now - 7 * 86400000).toISOString().split('T')[0];

    const [weekAppts, weekCancelled, weekCustomers] = await Promise.all([
      db.collection('appointments').countDocuments({ businessId: { $in: [bid, bidStr] }, date: { $gte: weekAgoStr } }),
      db.collection('appointments').countDocuments({ businessId: { $in: [bid, bidStr] }, status: 'cancelled', date: { $gte: weekAgoStr } }),
      db.collection('customers').countDocuments({ businessId: { $in: [bid, bidStr] }, createdAt: { $gte: new Date(now - 7 * 86400000) } })
    ]);

    const confirmed = await db.collection('appointments').find({
      businessId: { $in: [bid, bidStr] }, status: 'confirmed', date: { $gte: weekAgoStr }
    }).toArray();
    let revenue = 0;
    for (const appt of confirmed) {
      const svc = business.services?.find(s => s._id?.toString() === appt.serviceId || s.name === appt.serviceName);
      if (svc) revenue += svc.price || 0;
    }

    res.json({
      weekAppointments: weekAppts, weekCancelled,
      cancellationRate: weekAppts > 0 ? Math.round((weekCancelled / weekAppts) * 100) : 0,
      weekRevenue: revenue, newCustomers: weekCustomers
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Extended stats with monthly data and busiest day
app.get('/api/businesses/:slug/stats/extended', authMiddleware, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business || business._id.toString() !== req.businessId) return res.status(403).json({ error: 'Not authorized' });
    const bid = business._id;
    const bidStr = business._id.toString();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const weekAgoStr = new Date(now - 7 * 86400000).toISOString().split('T')[0];

    const monthAppts = await db.collection('appointments').find({
      businessId: { $in: [bid, bidStr] }, date: { $gte: monthStart }, status: { $ne: 'cancelled' }
    }).toArray();

    let monthRevenue = 0;
    const dayCount = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    for (const a of monthAppts) {
      const svc = business.services?.find(s => s._id?.toString() === a.serviceId || s.name === a.serviceName);
      if (svc && a.status === 'confirmed') monthRevenue += svc.price || 0;
      const d = new Date(a.date + 'T00:00:00');
      if (!isNaN(d.getTime())) dayCount[d.getDay()]++;
    }

    const monthCustomers = await db.collection('customers').countDocuments({
      businessId: { $in: [bid, bidStr] }, createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) }
    });

    res.json({
      monthAppointments: monthAppts.length,
      monthRevenue,
      monthNewCustomers: monthCustomers,
      busiestDayData: dayCount, // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
    });
  } catch (err) {
    console.error('Extended stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ REMINDERS API ============

// Check for pending reminders (called by cron from Johnny's VM)
app.post('/api/reminders/check', async (req, res) => {
  try {
    const REMINDER_INTERVALS = [
      { minutes: 1440, key: '1day' },
      { minutes: 120, key: '2hours' },
      { minutes: 30, key: '30min' },
    ];

    const businesses = await db.collection('businesses').find({ isActive: { $ne: false } }).toArray();
    const remindersToSend = [];

    for (const biz of businesses) {
      const settings = biz.reminderSettings || { '1day': true, '2hours': true, '30min': false };

      for (const interval of REMINDER_INTERVALS) {
        if (!settings[interval.key]) continue;

        const targetTime = new Date(Date.now() + interval.minutes * 60000);
        const targetDate = targetTime.toISOString().split('T')[0];
        const targetHour = targetTime.toTimeString().slice(0, 5);

        const appointments = await db.collection('appointments').find({
          businessId: biz._id.toString(),
          date: targetDate,
          startTime: targetHour,
          status: { $in: ['confirmed', 'pending'] },
          [`reminders.${interval.key}`]: { $ne: true },
        }).toArray();

        for (const appt of appointments) {
          const template = settings.template || 'שלום {customer_name}, תזכורת: יש לך תור ל{service} ב{date} בשעה {time} ב{business_name}. לאישור השב 1, לביטול השב 2.';
          const message = template
            .replace(/{customer_name}/g, appt.customerName || '')
            .replace(/{service}/g, appt.serviceName || '')
            .replace(/{date}/g, appt.date || '')
            .replace(/{time}/g, appt.startTime || '')
            .replace(/{business_name}/g, biz.name || '');

          remindersToSend.push({
            appointmentId: appt._id.toString(),
            businessId: biz._id.toString(),
            customerPhone: appt.customerPhone,
            customerName: appt.customerName,
            message,
            intervalKey: interval.key,
          });
        }
      }
    }

    res.json({ reminders: remindersToSend, count: remindersToSend.length });
  } catch (err) {
    console.error('Reminders check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark reminder as sent
app.post('/api/reminders/mark-sent', async (req, res) => {
  try {
    const { appointmentId, intervalKey } = req.body;
    if (!appointmentId || !intervalKey) return res.status(400).json({ error: 'Missing appointmentId or intervalKey' });

    await db.collection('appointments').updateOne(
      { _id: new ObjectId(appointmentId) },
      { $set: { [`reminders.${intervalKey}`]: true } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark reminder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ ADMIN ============

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'snaptor2026';
const ADMIN_JWT_SECRET = JWT_SECRET + '-admin';

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (!decoded.admin) return res.status(401).json({ error: 'Not admin' });
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ admin: true }, ADMIN_JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

app.get('/api/admin/data', adminAuth, async (req, res) => {
  try {
    const [businesses, customers, appointments] = await Promise.all([
      db.collection('businesses').find({}).toArray(),
      db.collection('customers').find({}).toArray(),
      db.collection('appointments').find({}).toArray().then(a => a.sort((x,y) => (y.date+y.startTime).localeCompare(x.date+x.startTime)).slice(0, 200)),
    ]);
    // Convert ObjectIds to strings for frontend matching
    businesses.forEach(b => { b._id = b._id.toString(); });
    appointments.forEach(a => { a._id = a._id.toString(); a.businessId = a.businessId?.toString(); });
    res.json({ businesses, customers, appointments });
  } catch (err) {
    console.error('Admin data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/businesses/:id', adminAuth, async (req, res) => {
  try {
    const bid = req.params.id;
    const { name, phone, type, slug } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (type !== undefined) update.type = type;
    if (slug !== undefined) {
      const s = slug.toLowerCase().trim();
      const existing = await db.collection('businesses').findOne({ slug: s, _id: { $ne: new ObjectId(bid) } });
      if (existing) return res.status(400).json({ error: 'Slug already exists' });
      update.slug = s;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
    await db.collection('businesses').updateOne({ _id: new ObjectId(bid) }, { $set: update });
    res.json({ success: true });
  } catch (err) {
    console.error('Admin edit business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/admin/businesses/:id/toggle', adminAuth, async (req, res) => {
  try {
    const bid = req.params.id;
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(bid) });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const newState = !(business.isActive !== false);
    await db.collection('businesses').updateOne({ _id: new ObjectId(bid) }, { $set: { isActive: newState } });
    res.json({ success: true, isActive: newState });
  } catch (err) {
    console.error('Admin toggle business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/businesses/:id', adminAuth, async (req, res) => {
  try {
    const bid = req.params.id;
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(bid) });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const bidObj = new ObjectId(bid);
    await Promise.all([
      db.collection('businesses').deleteOne({ _id: bidObj }),
      db.collection('appointments').deleteMany({ businessId: { $in: [bidObj, bid] } }),
      db.collection('customers').deleteMany({ businessId: { $in: [bidObj, bid] } }),
      db.collection('tasks').deleteMany({ businessId: { $in: [bidObj, bid] } }),
      db.collection('announcements').deleteMany({ businessId: { $in: [bidObj, bid] } }),
    ]);
    res.json({ success: true, deleted: business.slug });
  } catch (err) {
    console.error('Admin delete business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Public booking page route
app.get('/book/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
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

// SPA fallback — must be LAST
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path === '/admin' || req.path.startsWith('/book/')) return;
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`PickTime running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});
