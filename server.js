require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const jwt = require('jsonwebtoken');
const { Expo } = require('expo-server-sdk');
const T = require('./lib/time');
const mongoLimit = require('./lib/mongo-rate-limit');
const otp = require('./lib/otp');
const { createSender } = require('./lib/otp-sender');
const reminders = require('./lib/reminders');
const reminderService = require('./reminder-service.js');
const manageLink = require('./lib/manage-link');
const security = require('./lib/security');

const IS_PROD = process.env.NODE_ENV === 'production';

// ============ SECRETS / CONFIG ============
// Never fall back to a well-known secret in production: anyone could forge owner tokens.
if (!process.env.JWT_SECRET && IS_PROD) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start in production.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-jwt-secret';
const OTP_SECRET = process.env.OTP_SECRET || JWT_SECRET;
const TOKEN_TTL = process.env.TOKEN_TTL || '7d';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PROD ? '' : 'dev-admin-password');
const ADMIN_JWT_SECRET = JWT_SECRET + '-admin';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://snaptor.app';
const MANAGE_SECRET = manageLink.deriveSecret(process.env, JWT_SECRET);
const intEnv = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : def; };

let otpSender = createSender(process.env);
function otpFlagOn() { return String(process.env.AUTH_OTP_REQUIRED || '').toLowerCase() === 'true'; }
function otpEnabled() { return otpFlagOn() && !!otpSender.configured; }

const app = express();

// Azure App Service / ARR terminates TLS and forwards X-Forwarded-For.
// '1' = trust the first proxy hop. Required for correct per-client rate limits.
app.set('trust proxy', 1);

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

/** Canonical local form "05XXXXXXXX" for Israeli numbers, else digits-only. */
function phoneKey(phone) {
  let p = String(phone || '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+972')) p = '0' + p.slice(4);
  else if (p.startsWith('972')) p = '0' + p.slice(3);
  return p.replace(/[^\d+]/g, '');
}

/** All stored formats that may represent the same phone (backward compatible lookup). */
function phoneVariants(phone) {
  const raw = sanitizeQuery(String(phone || '')).trim();
  const key = phoneKey(raw);
  const set = new Set([raw, key]);
  if (/^0\d{9}$/.test(key)) {
    set.add(`${key.slice(0, 3)}-${key.slice(3)}`);
    set.add(`${key.slice(0, 3)}-${key.slice(3, 6)}-${key.slice(6)}`);
    set.add('+972' + key.slice(1));
    set.add('972' + key.slice(1));
  }
  return [...set].filter(Boolean);
}

function maskPhone(phone) {
  const p = phoneKey(phone);
  return p.length > 5 ? `${p.slice(0, 3)}***${p.slice(-2)}` : '***';
}

const isStr = (v) => typeof v === 'string';
const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;

// ============ IDS / TENANT SCOPING ============

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) return null;
  return new ObjectId(id);
}

/** businessId is stored as ObjectId in some collections and as string in others. */
function bizIdFilter(business) {
  return { $in: [business._id, business._id.toString()] };
}

/** Filter for a child document that must belong to the business. */
function ownedFilter(business, id) {
  return { _id: id instanceof ObjectId ? id : toObjectId(id), businessId: bizIdFilter(business) };
}

/** Add a string `id` (= _id) to embedded services/staff so clients have one stable key. */
function withId(item) {
  if (!item || typeof item !== 'object') return item;
  if (item._id) return { ...item, id: item._id.toString() };
  return item;
}

function normalizeBusiness(business) {
  if (!business) return business;
  return {
    ...business,
    id: business._id ? business._id.toString() : business.id,
    timezone: T.businessTz(business),
    services: (business.services || []).map(withId),
    staff: (business.staff || []).map(withId),
  };
}

function publicService(s) {
  const id = s._id ? s._id.toString() : (s.id != null ? String(s.id) : undefined);
  return { _id: s._id || id, id, name: s.name, duration: s.duration, price: s.price };
}

function publicStaff(s) {
  return { _id: s._id, id: s._id ? s._id.toString() : undefined, name: s.name, role: s.role, services: (s.services || []).map(String), workingHours: s.workingHours || {} };
}

/** Find a service by its _id string. Legacy services without _id can match their old `id`. */
function findService(business, serviceId) {
  if (!isNonEmptyStr(serviceId)) return null;
  const services = business.services || [];
  return services.find(s => s && s._id && s._id.toString() === serviceId)
    || services.find(s => s && !s._id && s.id != null && String(s.id) === serviceId)
    || null;
}

function serviceKey(service) {
  return service._id ? service._id.toString() : String(service.id);
}

// ============ AUTH HELPERS ============

function signOwnerToken(business) {
  return jwt.sign({ businessId: business._id.toString(), slug: business.slug }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function logAuth(event, req, extra = {}) {
  const parts = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`[auth] ${event} ip=${clientIp(req)} ${parts}`.trim());
}

// Auth middleware — verifies the JWT and that the business still exists
// (a deleted account's tokens stop working immediately).
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const oid = toObjectId(decoded && decoded.businessId);
  if (!oid) return res.status(401).json({ error: 'Invalid token' });
  try {
    const exists = await db.collection('businesses').findOne({ _id: oid }, { projection: { _id: 1 } });
    if (!exists) return res.status(401).json({ error: 'Session expired' });
  } catch (err) {
    return next(err);
  }
  req.businessId = decoded.businessId;
  req.businessSlug = decoded.slug;
  next();
}

// Ownership verification: the authenticated user must own :slug.
// 404 when the business doesn't exist, 403 when it belongs to someone else.
async function verifyOwnership(req, res, next) {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    if (business._id.toString() !== req.businessId) {
      return res.status(403).json({ error: 'Not authorized for this business' });
    }
    req.business = business;
    next();
  } catch (err) { next(err); }
}

const requireOwner = [authMiddleware, verifyOwnership];

// Sanitize all POST/PUT bodies
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// Shared-secret guard for scheduler endpoints (/api/reminders/*).
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function requireCronSecret(req, res, next) {
  const expected = process.env.REMINDER_CRON_SECRET;
  if (!expected) return res.status(503).json({ error: 'Reminder endpoints are disabled (REMINDER_CRON_SECRET not set)' });
  const got = req.get('x-cron-secret') || '';
  if (!got || !crypto.timingSafeEqual(sha256(got), sha256(expected))) {
    console.warn(`[reminders] rejected unauthenticated ${req.method} ${req.path} ip=${clientIp(req)}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ============ RATE LIMITERS ============

// Client IP without the source port. Azure App Service forwards
// X-Forwarded-For as "ip:port" (IPv4) or "[ipv6]:port", so with trust proxy
// req.ip would differ per TCP connection and per-IP limits would never trip.
function clientIp(req) {
  const raw = String(req.ip || (req.socket && req.socket.remoteAddress) || '').trim();
  let m = raw.match(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/);   // [ipv6]:port
  if (m) return m[1];
  m = raw.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/); // ipv4[:port]
  if (m) return m[1];
  return raw; // bare IPv6 or unknown
}

// Authenticated API requests: key by businessId from JWT when present, else IP.
// Avoids carrier-NAT / shared-WiFi buckets locking out mobile WebView users.
function rateLimitKey(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
      if (decoded && decoded.businessId) return 'biz:' + decoded.businessId;
    } catch { /* fall through to IP */ }
  }
  return 'ip:' + clientIp(req);
}

// Higher ceiling; skips static assets and health checks.
// validate:false — custom keyGenerator mixes biz: and ip: prefixes (not bare IPv6).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: intEnv('API_RATE_LIMIT', 600), // ~40 req/min sustained — fine for a dashboard SPA
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  validate: false,
  skip: (req) => {
    if (!req.path.startsWith('/api/')) return true;
    if (req.path === '/api/health') return true;
    return false;
  },
  message: { error: 'Too many requests. Please try again shortly.' },
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: intEnv('BOOKING_RATE_LIMIT', 10),
  message: { error: 'Too many bookings. Try again later.' },
  validate: false,
  keyGenerator: (req) => 'ip:' + clientIp(req),
});

const createBusinessLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: intEnv('CREATE_BUSINESS_RATE_LIMIT', 3),
  message: { error: 'Too many businesses created. Try again tomorrow.' },
  validate: false,
  keyGenerator: (req) => 'ip:' + clientIp(req),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: intEnv('LOGIN_RATE_LIMIT', 20),
  message: { error: 'Too many login attempts. Try again later.' },
  validate: false,
  keyGenerator: (req) => 'ip:' + clientIp(req),
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: intEnv('ADMIN_LOGIN_RATE_LIMIT', 10),
  message: { error: 'Too many attempts. Try again later.' },
  validate: false,
  keyGenerator: (req) => 'ip:' + clientIp(req),
});

// Per-phone limits (MongoDB-backed so they survive restarts)
const PHONE_LOGIN_LIMIT = { max: intEnv('PHONE_LOGIN_LIMIT', 10), windowMs: 15 * 60 * 1000 };
const OTP_SEND_LIMITS = [
  { scope: 'phone', max: intEnv('OTP_SEND_PER_PHONE_15M', 3), windowMs: 15 * 60 * 1000 },
  { scope: 'phone', max: intEnv('OTP_SEND_PER_PHONE_DAY', 10), windowMs: 24 * 60 * 60 * 1000 },
  { scope: 'ip', max: intEnv('OTP_SEND_PER_IP_HOUR', 10), windowMs: 60 * 60 * 1000 },
];

// ============ MIDDLEWARE ============

app.use(helmet({ contentSecurityPolicy: false }));
// Content-Security-Policy (CSP_MODE=enforce|report-only|off). The Expo web bundle needs no
// inline scripts or eval; the legacy admin/book pages get a looser policy (inline scripts).
app.use(security.cspMiddleware(process.env));
// CORS: only the app's own origins (same-origin requests and native apps send no Origin).
app.use(cors(security.corsOptions(process.env, IS_PROD)));
// CSP violation reports (browsers send application/csp-report or application/reports+json)
app.post('/api/csp-report', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }), async (req, res) => {
  try {
    const r = await mongoLimit.hit(db, `csp:${clientIp(req)}`, 30, 60 * 60 * 1000);
    if (r.allowed) console.warn('[csp] violation', security.summarizeCspReport(req.body));
  } catch { /* never fail a report */ }
  res.status(204).end();
});
app.use(express.json({ limit: '200kb' }));
app.use(sanitizeBody);

// Static files FIRST — never touch the API rate limiter
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));

// API rate limiter (skips non-/api and /api/health via skip())
app.use(apiLimiter);

// Malformed ObjectIds in the URL → 400 instead of a 500 from new ObjectId()
function validateObjectIdParam(req, res, next, value) {
  if (!toObjectId(value)) return res.status(400).json({ error: 'Invalid id' });
  next();
}
app.param('id', validateObjectIdParam);
app.param('requestId', validateObjectIdParam);

// MongoDB connection
let db;
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');

async function connectDB() {
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'picktime');
  await db.collection('businesses').createIndex({ slug: 1 }, { unique: true });
  await db.collection('appointments').createIndex({ businessId: 1, date: 1 });
  await db.collection('appointments').createIndex({ date: 1, status: 1 });
  await db.collection('customers').createIndex({ businessId: 1, phone: 1 });
  await db.collection('customers').createIndex({ businessId: 1, lastVisit: -1 });
  await db.collection('tasks').createIndex({ businessId: 1, completed: 1 });
  await db.collection('push_tokens').createIndex({ token: 1 }, { unique: true });
  await db.collection('push_tokens').createIndex({ business_id: 1 });
  await db.collection('push_tokens').createIndex({ last_seen_at: 1 });
  await db.collection('booking_tokens').createIndex({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 });
  await mongoLimit.ensureIndexes(db);
  await otp.ensureIndexes(db);
  console.log('Connected to MongoDB');
  return db;
}

// Helper: get business by slug
async function getBusinessBySlug(slug) {
  if (typeof slug !== 'string') return null;
  return db.collection('businesses').findOne({ slug: sanitizeQuery(slug) });
}

// ============ PUSH NOTIFICATIONS ============

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

const PUSH_COPY = {
  he: {
    new_booking_title: 'תור חדש',
    new_booking_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} הזמין/ה ${serviceName} ב-${date} ${time}`,
    cancelled_title: 'תור בוטל',
    cancelled_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} — ${serviceName} ב-${date} ${time} בוטל`,
    reschedule_title: 'בקשה לשינוי מועד',
    reschedule_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} מבקש/ת להעביר את ${serviceName} ל-${date} ${time}`,
    reminder_title: 'תזכורת לתור',
    reminder_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} — ${serviceName} ב-${date} ${time}`,
  },
  en: {
    new_booking_title: 'New booking',
    new_booking_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} booked ${serviceName} on ${date} at ${time}`,
    cancelled_title: 'Booking cancelled',
    cancelled_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} — ${serviceName} on ${date} at ${time} was cancelled`,
    reschedule_title: 'Reschedule request',
    reschedule_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} asks to move ${serviceName} to ${date} at ${time}`,
    reminder_title: 'Appointment reminder',
    reminder_body: ({ customerName, serviceName, date, time }) =>
      `${customerName} — ${serviceName} on ${date} at ${time}`,
  },
};

async function notifyBusiness(businessId, { titleKey, bodyKey, payload, url }) {
  if (!db || !businessId) return;
  const tokens = await db.collection('push_tokens')
    .find({ business_id: businessId.toString() })
    .toArray();
  if (!tokens.length) return;

  const messages = [];
  for (const t of tokens) {
    if (!Expo.isExpoPushToken(t.token)) continue;
    const copy = PUSH_COPY[t.locale === 'en' ? 'en' : 'he'];
    messages.push({
      to: t.token,
      sound: 'default',
      title: copy[titleKey],
      body: copy[bodyKey](payload),
      data: { url: url || '/(dashboard)/appointments' },
      channelId: 'default',
    });
  }
  if (!messages.length) return;

  const tickets = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk.map((ticket, i) => ({ ticket, token: chunk[i].to })));
    } catch (err) {
      console.error('expo push send error', err);
    }
  }

  // Receipts cleanup (~15 min later). Fire-and-forget.
  setTimeout(() => { void cleanupPushReceipts(tickets); }, 15 * 60 * 1000);
}

async function cleanupPushReceipts(tickets) {
  if (!db || !tickets || !tickets.length) return;
  const ids = {};
  for (const { ticket, token } of tickets) {
    if (ticket && ticket.status === 'ok' && ticket.id) ids[ticket.id] = token;
    if (ticket && ticket.status === 'error' && ticket.details && ticket.details.error === 'DeviceNotRegistered') {
      await db.collection('push_tokens').deleteOne({ token });
    }
  }
  const receiptIds = Object.keys(ids);
  if (!receiptIds.length) return;
  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  for (const chunk of receiptIdChunks) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(receipts)) {
        if (receipt.status === 'error' && receipt.details && receipt.details.error === 'DeviceNotRegistered') {
          const expoToken = (receipt.details && receipt.details.expoPushToken) || ids[id];
          if (expoToken) await db.collection('push_tokens').deleteOne({ token: expoToken });
        }
      }
    } catch (err) {
      console.error('expo receipts error', err);
    }
  }
}

// ============ AUTH ============
//
// Two modes:
//  * Legacy (default, AUTH_OTP_REQUIRED unset/false or no OTP provider configured):
//    phone-only login, hardened with per-IP + per-phone rate limits, 7-day tokens and audit logs.
//  * OTP (AUTH_OTP_REQUIRED=true and an OTP provider configured, see lib/otp-sender.js):
//    POST /api/auth/login {phone} sends a 6-digit code; POST /api/auth/verify-otp {phone, code}
//    returns the session. No token or business list is ever returned before the code is verified.

function businessListItem(b) { return { _id: b._id, name: b.name, slug: b.slug, type: b.type }; }

async function findBusinessesByPhone(phone) {
  return db.collection('businesses').find({ phone: { $in: phoneVariants(phone) } }).toArray();
}

async function issueSession(res, business, allBusinesses) {
  const token = signOwnerToken(business);
  await db.collection('businesses').updateOne({ _id: business._id }, { $set: { lastLogin: new Date() } });
  return res.json({ exists: true, otpRequired: false, token, business: normalizeBusiness(business), businesses: allBusinesses });
}

function signLoginTicket(phone) {
  return jwt.sign({ purpose: 'login', phone: phoneKey(phone) }, JWT_SECRET, { expiresIn: '10m' });
}

function verifyLoginTicket(ticket, phone) {
  if (!isNonEmptyStr(ticket)) return false;
  try {
    const d = jwt.verify(ticket, JWT_SECRET);
    return d && d.purpose === 'login' && d.phone === phoneKey(phone);
  } catch { return false; }
}

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { phone, slug, loginTicket, lang } = req.body || {};
    if (!isNonEmptyStr(phone)) return res.status(400).json({ error: 'Phone is required' });
    const key = phoneKey(phone);

    if (otpEnabled()) {
      // Business selection after a verified code (multi-business phones)
      if (loginTicket !== undefined) {
        if (!verifyLoginTicket(loginTicket, phone)) return res.status(401).json({ error: 'Verification expired. Please log in again.', otpRequired: true });
        const businesses = await findBusinessesByPhone(phone);
        const business = businesses.find(b => b.slug === slug);
        if (!business) return res.status(404).json({ error: 'Business not found' });
        logAuth('login.ticket', req, { phone: maskPhone(phone), slug: business.slug });
        return issueSession(res, business, businesses.map(businessListItem));
      }

      if (!isValidIsraeliPhone(phone)) return res.status(400).json({ error: 'Invalid phone number format' });
      for (const lim of OTP_SEND_LIMITS) {
        const k = lim.scope === 'phone' ? `otp-send:phone:${key}` : `otp-send:ip:${clientIp(req)}`;
        const r = await mongoLimit.hit(db, k, lim.max, lim.windowMs);
        if (!r.allowed) {
          logAuth('otp.send.rate_limited', req, { phone: maskPhone(phone), scope: lim.scope });
          res.set('Retry-After', String(r.retryAfterSec));
          return res.status(429).json({ error: 'Too many code requests. Try again later.', retryAfter: r.retryAfterSec });
        }
      }
      // Same response whether or not the phone is registered (no account enumeration).
      const code = await otp.issue(db, OTP_SECRET, key);
      try {
        await otpSender.send(key, code, { lang });
      } catch (err) {
        console.error('[auth] OTP send failed:', err.message);
        return res.status(502).json({ error: 'Could not send the verification code. Try again shortly.' });
      }
      logAuth('otp.sent', req, { phone: maskPhone(phone), via: otpSender.name });
      return res.json({ otpRequired: true, sent: true, expiresIn: Math.round(otp.OTP_TTL_MS / 1000) });
    }

    // ---- Legacy phone-only login (until an OTP provider is configured) ----
    const lim = await mongoLimit.hit(db, `login:phone:${key}`, PHONE_LOGIN_LIMIT.max, PHONE_LOGIN_LIMIT.windowMs);
    if (!lim.allowed) {
      logAuth('login.rate_limited', req, { phone: maskPhone(phone) });
      res.set('Retry-After', String(lim.retryAfterSec));
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    const businesses = await findBusinessesByPhone(phone);
    if (!businesses.length) {
      logAuth('login.unknown_phone', req, { phone: maskPhone(phone) });
      return res.json({ exists: false, otpRequired: false });
    }
    const allBusinesses = businesses.map(businessListItem);
    // If multiple businesses and no slug specified, return list for selection (no token)
    if (businesses.length > 1 && !slug) {
      return res.json({ exists: true, otpRequired: false, businesses: allBusinesses });
    }
    let business = slug ? businesses.find(b => b.slug === slug) : businesses[0];
    if (!business) business = businesses[0];
    logAuth('login.ok', req, { phone: maskPhone(phone), slug: business.slug, mode: 'legacy' });
    return issueSession(res, business, allBusinesses);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: intEnv('OTP_VERIFY_RATE_LIMIT', 30),
  message: { error: 'Too many attempts. Try again later.' },
  validate: false,
  keyGenerator: (req) => 'ip:' + clientIp(req),
});

app.post('/api/auth/verify-otp', otpVerifyLimiter, async (req, res) => {
  try {
    if (!otpEnabled()) return res.status(400).json({ error: 'OTP login is not enabled' });
    const { phone, code, slug } = req.body || {};
    if (!isNonEmptyStr(phone) || !isStr(code) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Phone and 6-digit code are required' });
    }
    const key = phoneKey(phone);
    const result = await otp.verify(db, OTP_SECRET, key, code);
    if (result !== 'ok') {
      logAuth('otp.verify.fail', req, { phone: maskPhone(phone), result });
      if (result === 'locked') return res.status(429).json({ error: 'Too many wrong codes. Request a new code.', code: 'otp_locked' });
      if (result === 'expired') return res.status(400).json({ error: 'The code expired. Request a new code.', code: 'otp_expired' });
      return res.status(400).json({ error: 'Wrong code', code: 'otp_invalid' });
    }
    const businesses = await findBusinessesByPhone(phone);
    logAuth('otp.verify.ok', req, { phone: maskPhone(phone), businesses: businesses.length });
    if (!businesses.length) return res.json({ exists: false, phoneVerified: true });
    const allBusinesses = businesses.map(businessListItem);
    if (businesses.length > 1 && !slug) {
      return res.json({ exists: true, businesses: allBusinesses, loginTicket: signLoginTicket(phone) });
    }
    const business = (slug && businesses.find(b => b.slug === slug)) || businesses[0];
    return issueSession(res, business, allBusinesses);
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sliding session: exchange a valid (unexpired) token for a fresh one.
app.post('/api/auth/refresh', authMiddleware, async (req, res) => {
  try {
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.businessId) });
    if (!business) return res.status(401).json({ error: 'Session expired' });
    res.json({ token: signOwnerToken(business) });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user's full business data (authenticated)
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.businessId) });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json(normalizeBusiness(business));
  } catch (err) {
    console.error('Auth me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ PUSH TOKENS ============

app.post('/api/push-tokens', authMiddleware, async (req, res) => {
  try {
    const { token, platform, appVersion, locale } = req.body || {};
    if (!isStr(token) || !Expo.isExpoPushToken(token)) {
      return res.status(400).json({ error: 'Invalid Expo push token' });
    }
    const plat = platform === 'android' ? 'android' : 'ios';
    const now = new Date();
    await db.collection('push_tokens').updateOne(
      { token },
      {
        $set: {
          token,
          business_id: req.businessId,
          platform: plat,
          app_version: isStr(appVersion) ? appVersion : null,
          locale: locale === 'en' ? 'en' : 'he',
          last_seen_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('push-tokens POST', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/push-tokens', authMiddleware, async (req, res) => {
  try {
    const token = (req.body && req.body.token) || req.query.token;
    if (!isNonEmptyStr(token)) return res.status(400).json({ error: 'token required' });
    await db.collection('push_tokens').deleteOne({
      token,
      business_id: req.businessId,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('push-tokens DELETE', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Account deletion (App Store 5.1.1(v)) — requires Bearer auth + confirmSlug match
app.delete('/api/account', authMiddleware, async (req, res) => {
  try {
    const raw = req.body && req.body.confirmSlug;
    const confirmSlug = (isStr(raw) ? raw : '').toLowerCase().trim();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.businessId) });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    if (!confirmSlug || confirmSlug !== business.slug) {
      return res.status(400).json({ error: 'confirmSlug does not match' });
    }

    const bid = business._id;
    const bidStr = bid.toString();

    await Promise.all([
      db.collection('appointments').deleteMany({ businessId: { $in: [bid, bidStr] } }),
      db.collection('customers').deleteMany({ businessId: { $in: [bid, bidStr] } }),
      db.collection('tasks').deleteMany({ businessId: { $in: [bid, bidStr] } }),
      db.collection('announcements').deleteMany({ businessId: { $in: [bid, bidStr] } }),
      db.collection('push_tokens').deleteMany({ business_id: bidStr }),
      db.collection('businesses').deleteOne({ _id: bid }),
    ]);
    logAuth('account.deleted', req, { slug: business.slug });
    res.json({ success: true, deleted: business.slug });
  } catch (err) {
    console.error('Account delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ BOOKING TOKEN ============
// Stored in MongoDB (TTL) so tokens survive restarts and work across instances.

const BOOKING_TOKEN_TTL_MS = 10 * 60 * 1000;

app.get('/api/businesses/:slug/booking-token', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('booking_tokens').insertOne({ _id: token, slug: business.slug, createdAt: new Date(), used: false });
    res.json({ token });
  } catch (err) {
    console.error('Booking token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function consumeBookingToken(token, slug) {
  if (!isNonEmptyStr(token)) return false;
  const r = await db.collection('booking_tokens').findOneAndUpdate(
    { _id: token, slug, used: false, createdAt: { $gt: new Date(Date.now() - BOOKING_TOKEN_TTL_MS) } },
    { $set: { used: true, usedAt: new Date() } }
  );
  return !!r;
}

// ============ BUSINESSES ============

const DEFAULT_WORKING_HOURS = {
  sunday: { start: '09:00', end: '18:00', enabled: true },
  monday: { start: '09:00', end: '18:00', enabled: true },
  tuesday: { start: '09:00', end: '18:00', enabled: true },
  wednesday: { start: '09:00', end: '18:00', enabled: true },
  thursday: { start: '09:00', end: '18:00', enabled: true },
  friday: { start: '09:00', end: '14:00', enabled: true },
  saturday: { start: '00:00', end: '00:00', enabled: false },
};

// Services: whitelist fields (no mass assignment) and validate duration/price (M-10).
function cleanServiceInput(s) {
  if (!s || typeof s !== 'object') return null;
  if (!isNonEmptyStr(s.name)) return null;
  const out = { name: s.name.trim().slice(0, 100) };
  out.duration = validDuration(s.duration) ? Number(s.duration) : 30;
  out.price = validPrice(s.price) ? Number(s.price) : 0;
  if (isStr(s.currency)) out.currency = s.currency.slice(0, 8);
  if (isStr(s.description)) out.description = s.description.slice(0, 500);
  if (isStr(s.color)) out.color = s.color.slice(0, 20);
  if (s.isActive === false) out.isActive = false;
  if (s._id) out._id = s._id;
  return out;
}

// ---- Slugs (M-4): format + reserved words (app routes, static files, brand names)
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48})[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'login', 'logout', 'register', 'signup', 'signin', 'auth', 'account',
  'settings', 'dashboard', 'privacy', 'support', 'terms', 'help', 'about', 'contact', 'pricing',
  'book', 'booking', 'manage', 'staff', 'services', 'customers', 'customer-detail', 'appointments',
  'tasks', 'groups', 'reminders', 'notifications', 'index', 'home', 'new', 'not-found',
  '_expo', '_sitemap', 'assets', 'static', 'public', 'js', 'css', 'img', 'images', 'fonts',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json', 'health', 'status',
  'www', 'mail', 'snaptor', 'picktime', 'test', 'demo', 'null', 'undefined',
]);
function slugProblem(slug) {
  if (!isStr(slug)) return 'invalid';
  const s = slug.toLowerCase().trim();
  if (!SLUG_RE.test(s) || s.includes('--')) return 'invalid';
  if (RESERVED_SLUGS.has(s)) return 'reserved';
  return null;
}

// ---- Working hours (H-9): per day enabled/start/end, optional breaks, per-day service mode
const MAX_BREAKS = 3;
class ValidationError extends Error {
  constructor(message, code) { super(message); this.status = 400; this.code = code; }
}
function cleanDay(name, d, existing) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new ValidationError(`Invalid hours for ${name}`, 'invalid_hours');
  const enabled = d.enabled === true;
  const prev = existing && typeof existing === 'object' ? existing : {};
  const startStr = isStr(d.start) ? d.start : (prev.start || '09:00');
  const endStr = isStr(d.end) ? d.end : (prev.end || '18:00');
  const start = parseHM(startStr), end = parseHM(endStr);
  if (enabled) {
    if (start == null || end == null) throw new ValidationError(`Invalid time format for ${name} (HH:MM)`, 'invalid_hours');
    if (end <= start) throw new ValidationError(`Closing time must be after opening time on ${name}`, 'invalid_hours');
  }
  const out = { enabled, start: start != null ? startStr : '09:00', end: end != null ? endStr : '18:00' };
  if (d.breaks !== undefined) {
    if (!Array.isArray(d.breaks) || d.breaks.length > MAX_BREAKS) throw new ValidationError(`Up to ${MAX_BREAKS} breaks per day`, 'invalid_breaks');
    const breaks = d.breaks.map(b => {
      const bs = b && parseHM(b.start), be = b && parseHM(b.end);
      if (bs == null || be == null || be <= bs) throw new ValidationError(`Invalid break on ${name}`, 'invalid_breaks');
      if (enabled && (bs < start || be > end)) throw new ValidationError(`Break on ${name} must be inside working hours`, 'invalid_breaks');
      return { start: b.start, end: b.end, s: bs, e: be };
    }).sort((a, b) => a.s - b.s);
    for (let i = 1; i < breaks.length; i++) {
      if (breaks[i].s < breaks[i - 1].e) throw new ValidationError(`Breaks overlap on ${name}`, 'invalid_breaks');
    }
    out.breaks = breaks.map(({ start: bs, end: be }) => ({ start: bs, end: be }));
  } else if (Array.isArray(prev.breaks)) {
    out.breaks = prev.breaks;
  }
  const mode = d.serviceMode !== undefined ? d.serviceMode : prev.serviceMode;
  if (mode === 'custom') {
    out.serviceMode = 'custom';
    const ids = d.enabledServices !== undefined ? d.enabledServices : prev.enabledServices;
    out.enabledServices = (Array.isArray(ids) ? ids : []).filter(v => typeof v === 'string' || typeof v === 'number').map(String).slice(0, 200);
  } else if (mode === 'all') {
    out.serviceMode = 'all';
  }
  return out;
}
/** Validate + normalise working hours. Days not provided keep their existing value. */
function cleanWorkingHours(input, existing) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('workingHours must be an object', 'invalid_hours');
  const base = existing && typeof existing === 'object' ? existing : DEFAULT_WORKING_HOURS;
  const out = {};
  for (const day of T.DAY_NAMES) {
    if (input[day] !== undefined) out[day] = cleanDay(day, input[day], base[day]);
    else if (base[day]) out[day] = base[day];
  }
  return out;
}

// ---- Staff (M-17): whitelist fields; keep existing per-staff hours when the client omits them
function cleanStaffList(list, existing) {
  const prevById = new Map((existing || []).filter(s => s && s._id).map(s => [s._id.toString(), s]));
  return list.filter(s => s && typeof s === 'object' && isNonEmptyStr(s.name)).slice(0, 100).map(s => {
    const _id = toObjectId(String(s._id || s.id || '')) || new ObjectId();
    const prev = prevById.get(_id.toString()) || {};
    const out = { _id, name: s.name.trim().slice(0, 100), isActive: s.isActive !== false };
    for (const k of ['role', 'phone', 'email', 'color', 'avatar']) {
      if (isStr(s[k])) out[k] = s[k].slice(0, 200); else if (isStr(prev[k])) out[k] = prev[k];
    }
    const services = s.services !== undefined ? s.services : prev.services;
    out.services = (Array.isArray(services) ? services : []).filter(v => typeof v === 'string').map(String).slice(0, 200);
    if (Array.isArray(s.workingDays)) out.workingDays = s.workingDays.filter(v => (Number.isInteger(v) && v >= 0 && v <= 6) || (isStr(v) && v.length <= 10)).slice(0, 7);
    else if (Array.isArray(prev.workingDays)) out.workingDays = prev.workingDays;
    if (s.workingHours !== undefined && s.workingHours !== null) out.workingHours = cleanWorkingHours(s.workingHours, prev.workingHours || {});
    else if (prev.workingHours) out.workingHours = prev.workingHours;
    return out;
  });
}

// ---- Phone (H-12)
async function phoneTakenByOther(phone, businessId) {
  const other = await db.collection('businesses').findOne(
    { phone: { $in: phoneVariants(phone) }, _id: { $ne: businessId } }, { projection: { _id: 1 } });
  return !!other;
}

// Create business (rate limited)
app.post('/api/businesses', createBusinessLimiter, async (req, res) => {
  try {
    const { name, slug, type, phone, email, theme, workingHours, services } = req.body || {};
    if (!isNonEmptyStr(name) || !isNonEmptyStr(slug)) return res.status(400).json({ error: 'Name and slug are required' });
    const problem = slugProblem(slug);
    if (problem === 'reserved') return res.status(400).json({ error: 'This booking link is reserved', code: 'slug_reserved' });
    if (problem) return res.status(400).json({ error: 'Booking link may use a-z, 0-9 and dashes (3-50 characters)', code: 'slug_invalid' });

    const existing = await db.collection('businesses').findOne({ slug: slug.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'Slug already taken', code: 'slug_taken' });
    let hours = DEFAULT_WORKING_HOURS;
    if (workingHours !== undefined && workingHours !== null) {
      try { hours = cleanWorkingHours(workingHours, DEFAULT_WORKING_HOURS); }
      catch (e) { if (e instanceof ValidationError) return res.status(400).json({ error: e.message, code: e.code }); throw e; }
    }

    const business = {
      name,
      slug: slug.toLowerCase().trim(),
      type: type || 'general',
      phone: isStr(phone) ? phone : '',
      email: isStr(email) ? email : '',
      theme: theme || 'default',
      customization: { colors: {} },
      workingHours: hours,
      services: (Array.isArray(services) ? services : []).map(cleanServiceInput).filter(Boolean).map(s => ({ ...s, _id: new ObjectId() })),
      isActive: true,
      createdAt: new Date()
    };

    const result = await db.collection('businesses').insertOne(business);
    business._id = result.insertedId;
    const token = signOwnerToken(business);
    res.status(201).json({ ...normalizeBusiness(business), token });
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
    // Return only public fields — NO phone, email, createdAt
    const { name, slug, type, theme, services, workingHours, customization } = business;
    res.json({
      name, slug, type, theme,
      timezone: T.businessTz(business),
      services: (services || []).map(publicService),
      workingHours,
      customization,
      staff: (business.staff || []).filter(s => s.isActive !== false).map(publicStaff),
    });
  } catch (err) {
    console.error('Get business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const REMINDER_SETTING_KEYS = ['1day', '2hours', '1hour', '30min', 'onBooking', 'postVisit'];
function cleanReminderSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const k of REMINDER_SETTING_KEYS) if (k in input) out[k] = input[k] === true;
  if (isStr(input.template)) out.template = input.template.slice(0, 500);
  return out;
}

// Update business by slug — PROTECTED
app.put('/api/businesses/:slug', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const { name, type, phone, email, theme, customization, workingHours, services, staff, reminderSettings, bookingPolicy } = req.body || {};
    const update = {};
    if (name !== undefined) {
      if (!isNonEmptyStr(name)) return res.status(400).json({ error: 'Name is required', code: 'invalid_name' });
      update.name = name.trim().slice(0, 100);
    }
    if (type !== undefined && isStr(type)) update.type = type.slice(0, 40);
    if (phone !== undefined && phoneKey(phone) !== phoneKey(business.phone)) {
      // The phone is the login credential: changes go through POST /phone (format, uniqueness,
      // OTP when enabled). Older clients may still send it here, so apply the same rules.
      if (otpEnabled()) return res.status(400).json({ error: 'Changing the phone requires verification', code: 'phone_verification_required' });
      if (!isValidIsraeliPhone(phone)) return res.status(400).json({ error: 'Invalid mobile number', code: 'invalid_phone' });
      if (await phoneTakenByOther(phone, business._id)) return res.status(409).json({ error: 'This phone is already used by another business', code: 'phone_taken' });
      update.phone = phoneKey(phone);
      logAuth('phone.changed', req, { slug: business.slug, phone: maskPhone(phone), via: 'put' });
    }
    if (email !== undefined && isStr(email)) update.email = email.slice(0, 200);
    if (theme !== undefined && isStr(theme)) update.theme = theme.slice(0, 40);
    if (customization !== undefined) update.customization = customization;
    if (workingHours !== undefined) update.workingHours = cleanWorkingHours(workingHours, business.workingHours);
    if (bookingPolicy !== undefined) {
      if (!bookingPolicy || typeof bookingPolicy !== 'object') return res.status(400).json({ error: 'Invalid bookingPolicy' });
      const bp = { ...(business.bookingPolicy || {}) };
      if (bookingPolicy.cancelCutoffHours !== undefined) {
        const n = Number(bookingPolicy.cancelCutoffHours);
        if (!Number.isFinite(n) || n < 0 || n > 168) return res.status(400).json({ error: 'cancelCutoffHours must be 0-168' });
        bp.cancelCutoffHours = n;
      }
      if (bookingPolicy.allowCustomerCancel !== undefined) bp.allowCustomerCancel = bookingPolicy.allowCustomerCancel !== false;
      if (bookingPolicy.allowCustomerReschedule !== undefined) bp.allowCustomerReschedule = bookingPolicy.allowCustomerReschedule !== false;
      update.bookingPolicy = bp;
    }
    if (reminderSettings !== undefined) {
      const rs = cleanReminderSettings(reminderSettings);
      if (!rs) return res.status(400).json({ error: 'Invalid reminderSettings' });
      update.reminderSettings = rs;
    }
    if (services !== undefined) {
      if (!Array.isArray(services)) return res.status(400).json({ error: 'services must be an array' });
      update.services = services.map(cleanServiceInput).filter(Boolean).map(s => ({ ...s, _id: toObjectId(String(s._id || '')) || new ObjectId() }));
    }
    if (staff !== undefined) {
      if (!Array.isArray(staff)) return res.status(400).json({ error: 'staff must be an array' });
      update.staff = cleanStaffList(staff, business.staff);
    }
    if (!Object.keys(update).length) return res.json(normalizeBusiness(business));

    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: business._id },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.json(normalizeBusiness(result));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, code: err.code });
    console.error('Update business by slug error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check username availability — PUBLIC
app.get('/api/check-username/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').toLowerCase().trim();
    const problem = slugProblem(username);
    if (problem) return res.json({ available: false, username, reason: problem });
    const existing = await db.collection('businesses').findOne({ slug: sanitizeQuery(username) });
    res.json({ available: !existing, username, ...(existing ? { reason: 'taken' } : {}) });
  } catch (err) {
    console.error('Check username error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change the business phone (= the login phone) — PROTECTED (H-12).
// Validates format and uniqueness; when OTP login is enabled the new number must be verified:
//   1) {phone}        → sends a code to the new number, returns {otpRequired:true}
//   2) {phone, code}  → verifies and saves.
app.post('/api/businesses/:slug/phone', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const { phone, code, lang } = req.body || {};
    if (!isValidIsraeliPhone(phone)) return res.status(400).json({ error: 'Invalid mobile number', code: 'invalid_phone' });
    const key = phoneKey(phone);
    if (key === phoneKey(business.phone)) return res.status(400).json({ error: 'This is already your phone number', code: 'phone_unchanged' });
    if (await phoneTakenByOther(phone, business._id)) return res.status(409).json({ error: 'This phone is already used by another business', code: 'phone_taken' });

    if (otpEnabled()) {
      const otpKey = `phonechange:${business._id}:${key}`;
      if (code === undefined || code === null || code === '') {
        for (const lim of OTP_SEND_LIMITS) {
          const k = lim.scope === 'phone' ? `otp-send:phone:${key}` : `otp-send:ip:${clientIp(req)}`;
          const r = await mongoLimit.hit(db, k, lim.max, lim.windowMs);
          if (!r.allowed) {
            res.set('Retry-After', String(r.retryAfterSec));
            return res.status(429).json({ error: 'Too many code requests. Try again later.', retryAfter: r.retryAfterSec });
          }
        }
        const otpCode = await otp.issue(db, OTP_SECRET, otpKey);
        try { await otpSender.send(key, otpCode, { lang }); }
        catch (err) {
          console.error('[auth] phone-change OTP send failed:', err.message);
          return res.status(502).json({ error: 'Could not send the verification code. Try again shortly.' });
        }
        logAuth('phone.change.otp_sent', req, { slug: business.slug, phone: maskPhone(phone) });
        return res.json({ otpRequired: true, sent: true, expiresIn: Math.round(otp.OTP_TTL_MS / 1000) });
      }
      if (!isStr(code) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: '6-digit code required', code: 'otp_invalid' });
      const result = await otp.verify(db, OTP_SECRET, otpKey, code);
      if (result !== 'ok') {
        logAuth('phone.change.otp_fail', req, { slug: business.slug, result });
        if (result === 'locked') return res.status(429).json({ error: 'Too many wrong codes. Request a new code.', code: 'otp_locked' });
        if (result === 'expired') return res.status(400).json({ error: 'The code expired. Request a new code.', code: 'otp_expired' });
        return res.status(400).json({ error: 'Wrong code', code: 'otp_invalid' });
      }
    }

    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: business._id }, { $set: { phone: key, phoneChangedAt: new Date() } }, { returnDocument: 'after' });
    logAuth('phone.changed', req, { slug: business.slug, from: maskPhone(business.phone), to: maskPhone(key), verified: otpEnabled() });
    res.json({ otpRequired: false, business: normalizeBusiness(updated) });
  } catch (err) {
    console.error('Phone change error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ SERVICES ============

function validDuration(v) { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= 24 * 60; }
function validPrice(v) { const n = Number(v); return Number.isFinite(n) && n >= 0; }

app.get('/api/businesses/:slug/services', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json((business.services || []).map(publicService));
  } catch (err) {
    console.error('List services error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/businesses/:slug/services', requireOwner, async (req, res) => {
  try {
    const { name, duration, price, currency } = req.body || {};
    if (!isNonEmptyStr(name) || duration === undefined) return res.status(400).json({ error: 'Name and duration are required' });
    if (!validDuration(duration)) return res.status(400).json({ error: 'Duration must be a whole number of minutes between 1 and 1440' });
    if (price !== undefined && price !== '' && !validPrice(price)) return res.status(400).json({ error: 'Price must be 0 or more' });

    const service = { _id: new ObjectId(), name, duration: Number(duration), price: Number(price) || 0, currency: isStr(currency) ? currency : 'ILS' };

    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: req.business._id },
      { $push: { services: service } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.status(201).json(withId(service));
  } catch (err) {
    console.error('Add service error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/businesses/:slug/services/:id', requireOwner, async (req, res) => {
  try {
    const { name, duration, price, currency } = req.body || {};
    const update = {};
    if (name !== undefined) {
      if (!isNonEmptyStr(name)) return res.status(400).json({ error: 'Name is required' });
      update['services.$.name'] = name;
    }
    if (duration !== undefined) {
      if (!validDuration(duration)) return res.status(400).json({ error: 'Duration must be a whole number of minutes between 1 and 1440' });
      update['services.$.duration'] = Number(duration);
    }
    if (price !== undefined) {
      if (!validPrice(price)) return res.status(400).json({ error: 'Price must be 0 or more' });
      update['services.$.price'] = Number(price);
    }
    if (currency !== undefined) update['services.$.currency'] = currency;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });

    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: req.business._id, 'services._id': new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Service not found' });
    const svc = result.services.find(s => s._id && s._id.toString() === req.params.id);
    res.json(withId(svc));
  } catch (err) {
    console.error('Update service error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/businesses/:slug/services/:id', requireOwner, async (req, res) => {
  try {
    const r = await db.collection('businesses').updateOne(
      { _id: req.business._id, 'services._id': new ObjectId(req.params.id) },
      { $pull: { services: { _id: new ObjectId(req.params.id) } } }
    );
    if (r.matchedCount === 0) return res.status(404).json({ error: 'Service not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete service error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ BOOKING ENGINE ============

const APPOINTMENT_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show', 'reschedule_requested'];
const INACTIVE_STATUSES = ['cancelled', 'declined'];

/** "HH:MM" → minutes; also accepts "24:00" (closing time). null if malformed. */
function parseHM(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

function businessDayHours(business, dayName) {
  const bh = business.workingHours && business.workingHours[dayName];
  if (!bh || !bh.enabled) return null;
  const start = parseHM(bh.start), end = parseHM(bh.end);
  if (start == null || end == null || end <= start) return null;
  return { start, end, raw: bh };
}

/** Breaks for the day as minute ranges (only enforced for customer bookings / availability). */
function dayBreaks(bizHours) {
  const raw = bizHours && bizHours.raw && Array.isArray(bizHours.raw.breaks) ? bizHours.raw.breaks : [];
  return raw.map(b => ({ start: parseHM(b && b.start), end: parseHM(b && b.end) })).filter(b => b.start != null && b.end != null && b.end > b.start);
}
function inBreak(breaks, start, end) { return breaks.some(b => b.start < end && b.end > start); }

function activeStaff(business) {
  return (business.staff || []).filter(s => s && s._id && s.isActive !== false);
}

function staffProvides(sm, svcKey) {
  return !Array.isArray(sm.services) || sm.services.length === 0 || sm.services.some(id => String(id) === svcKey);
}

/** Staff hours for the day: explicit entry wins, otherwise the business hours. null = off. */
function staffDayHours(sm, dayName, bizHours) {
  const sh = sm.workingHours && sm.workingHours[dayName];
  if (sh && typeof sh === 'object') {
    if (sh.enabled === false) return null;
    const start = parseHM(sh.start), end = parseHM(sh.end);
    if (start != null && end != null && end > start) return { start, end };
  }
  return bizHours ? { start: bizHours.start, end: bizHours.end } : null;
}

function apptRange(a) {
  const s = parseHM(a.startTime), e = parseHM(a.endTime);
  if (s == null) return null;
  return { start: s, end: e != null && e > s ? e : s + 30 };
}

function overlaps(a, start, end) {
  const r = apptRange(a);
  return !!r && r.start < end && r.end > start;
}

async function dayAppointments(business, date, excludeId) {
  const q = { businessId: bizIdFilter(business), date, status: { $nin: INACTIVE_STATUSES } };
  if (excludeId) q._id = { $ne: excludeId };
  return db.collection('appointments').find(q).toArray();
}

/**
 * Staff members free for [start,end). Appointments without a staff member consume
 * capacity (one person each) because we don't know who will serve them.
 */
function freeStaff(eligible, appts, start, end, { dayName, bizHours, enforceHours }) {
  const overlapping = appts.filter(a => overlaps(a, start, end));
  const busy = new Set(overlapping.filter(a => a.staffId).map(a => String(a.staffId)));
  const unassigned = overlapping.filter(a => !a.staffId).length;
  const free = eligible.filter(sm => {
    if (busy.has(sm._id.toString())) return false;
    if (enforceHours) {
      const h = staffDayHours(sm, dayName, bizHours);
      if (!h || start < h.start || end > h.end) return false;
    }
    return true;
  });
  return free.length > unassigned ? free : [];
}

function perDayServiceAllowed(bizHoursRaw, svcKey) {
  if (bizHoursRaw && bizHoursRaw.serviceMode === 'custom' && Array.isArray(bizHoursRaw.enabledServices)) {
    return bizHoursRaw.enabledServices.some(id => String(id) === svcKey);
  }
  return true;
}

class BookingError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/**
 * Validate and create an appointment.
 * Public bookings: must be in the future, on an open day, inside business (and staff) hours.
 * Owner bookings: may be outside hours (walk-ins, overtime) but not on a past date.
 */
async function createAppointment(business, input, { isOwner }) {
  const { serviceId, customerName, customerPhone, customerEmail, date, startTime, notes } = input;

  if (!isNonEmptyStr(customerName) || !isNonEmptyStr(customerPhone) || !isNonEmptyStr(date) || !isNonEmptyStr(startTime) || !isNonEmptyStr(serviceId)) {
    throw new BookingError(400, 'Missing required fields: customerName, customerPhone, date, startTime, serviceId', 'missing_fields');
  }
  if (!isValidIsraeliPhone(customerPhone)) throw new BookingError(400, 'Invalid phone number format', 'invalid_phone');
  const { service, staffMember, duration, endTime } = await checkSlot(business, input, { isOwner });

  const appointment = {
    businessId: business._id,
    serviceId: service._id || serviceKey(service),
    serviceName: service.name,
    staffId: staffMember ? staffMember._id.toString() : '',
    staffName: staffMember ? (staffMember.name || '') : '',
    customerName,
    customerPhone,
    customerEmail: isStr(customerEmail) ? customerEmail : '',
    date,
    startTime,
    endTime,
    duration,
    price: Number(service.price) || 0,
    status: 'pending',
    notes: isStr(notes) ? notes : '',
    source: isOwner ? 'owner' : 'online',
    manageNonce: manageLink.newNonce(),
    createdAt: new Date()
  };
  return insertAppointment(business, appointment, service);
}

/**
 * Validate a requested slot (shared by new bookings and customer reschedule requests).
 * Returns { service, staffMember, duration, start, end, endTime }.
 */
async function checkSlot(business, input, { isOwner, excludeId } = {}) {
  const { serviceId, staffId, date, startTime } = input;
  if (!isNonEmptyStr(date) || !isNonEmptyStr(startTime) || !isNonEmptyStr(serviceId)) {
    throw new BookingError(400, 'Missing required fields: date, startTime, serviceId', 'missing_fields');
  }
  if (!T.isValidYMD(date)) throw new BookingError(400, 'Invalid date (expected YYYY-MM-DD)', 'invalid_date');
  if (!T.isValidHM(startTime)) throw new BookingError(400, 'Invalid start time (expected HH:MM)', 'invalid_time');
  if (staffId !== undefined && staffId !== null && staffId !== '' && !isStr(staffId)) throw new BookingError(400, 'Invalid staffId', 'invalid_staff');

  const service = findService(business, serviceId);
  if (!service) throw new BookingError(400, 'Service not found', 'service_not_found');
  const duration = Number(service.duration);
  if (!validDuration(duration)) throw new BookingError(400, 'Service has an invalid duration', 'invalid_service');
  const svcKey = serviceKey(service);

  const start = T.hmToMin(startTime);
  const end = start + duration;
  if (end > 24 * 60) throw new BookingError(400, 'Appointment must end by midnight', 'outside_hours');
  const endTime = T.minToHM(end);

  const tz = T.businessTz(business);
  const now = T.nowInTz(tz);
  if (date < now.date) throw new BookingError(400, 'Cannot book a date in the past', 'past');
  if (!isOwner && date === now.date && start <= now.minutes) throw new BookingError(400, 'Cannot book a time in the past', 'past');

  const dayName = T.dayNameOf(date);
  const bizHours = businessDayHours(business, dayName);
  if (!isOwner) {
    if (!bizHours) throw new BookingError(400, 'The business is closed on this day', 'closed');
    if (start < bizHours.start || end > bizHours.end) throw new BookingError(400, 'Outside working hours', 'outside_hours');
    if (inBreak(dayBreaks(bizHours), start, end)) throw new BookingError(400, 'The business is on a break at this time', 'outside_hours');
  }
  const rawDay = business.workingHours && business.workingHours[dayName];
  if (!perDayServiceAllowed(rawDay, svcKey)) throw new BookingError(400, 'Service not available on this day', 'service_unavailable_day');

  const appts = await dayAppointments(business, date, excludeId);
  const staffAll = activeStaff(business);
  let staffMember = null;

  if (isNonEmptyStr(staffId)) {
    const sm = (business.staff || []).find(s => s && s._id && s._id.toString() === staffId);
    if (!sm) throw new BookingError(400, 'Staff member not found', 'staff_not_found');
    if (sm.isActive === false) throw new BookingError(400, 'Staff member is inactive', 'staff_inactive');
    if (!staffProvides(sm, svcKey)) throw new BookingError(400, 'Staff member does not provide this service', 'staff_service');
    if (!isOwner) {
      const h = staffDayHours(sm, dayName, bizHours);
      if (!h) throw new BookingError(400, 'Staff member not available on this day', 'staff_day_off');
      if (start < h.start || end > h.end) throw new BookingError(400, 'Outside the staff member\'s working hours', 'outside_hours');
    }
    if (appts.some(a => a.staffId && String(a.staffId) === staffId && overlaps(a, start, end))) {
      throw new BookingError(409, 'Time slot already booked', 'conflict');
    }
    staffMember = sm;
  } else if (staffAll.length > 0) {
    // "Any staff": assign the first free staff member who provides the service.
    const eligible = staffAll.filter(sm => staffProvides(sm, svcKey));
    if (!eligible.length) throw new BookingError(400, 'No staff member provides this service', 'staff_service');
    const free = freeStaff(eligible, appts, start, end, { dayName, bizHours, enforceHours: !isOwner });
    if (!free.length) throw new BookingError(409, 'Time slot already booked', 'conflict');
    staffMember = free[0];
  } else if (appts.some(a => overlaps(a, start, end))) {
    throw new BookingError(409, 'Time slot already booked', 'conflict');
  }
  return { service, staffMember, duration, start, end, endTime };
}

async function insertAppointment(business, appointment, service) {
  const { customerName, customerPhone, customerEmail } = appointment;
  const result = await db.collection('appointments').insertOne(appointment);
  appointment._id = result.insertedId;

  // Auto-create or update customer
  const bidStr = business._id.toString();
  const existingCustomer = await db.collection('customers').findOne({ businessId: bizIdFilter(business), phone: customerPhone });
  if (existingCustomer) {
    await db.collection('customers').updateOne(
      { _id: existingCustomer._id },
      { $set: { lastVisit: new Date(), name: customerName }, $inc: { totalVisits: 1, totalSpent: service.price || 0 } }
    );
  } else {
    await db.collection('customers').insertOne({
      businessId: bidStr,
      name: customerName,
      phone: customerPhone,
      email: isStr(customerEmail) ? customerEmail : '',
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

  // Push notify owner devices (non-blocking)
  void notifyBusiness(business._id, {
    titleKey: 'new_booking_title',
    bodyKey: 'new_booking_body',
    payload: {
      customerName: appointment.customerName,
      serviceName: appointment.serviceName,
      date: appointment.date,
      time: appointment.startTime,
    },
    url: '/(dashboard)/appointments',
  }).catch(err => console.error('notify error', err && err.message));

  return appointment;
}

function apptOut(a) {
  if (!a) return a;
  const { manageNonce, ...rest } = a; // never expose the nonce
  return { ...rest, id: a._id.toString() };
}

function manageTokenFor(appt) { return appt && appt.manageNonce ? manageLink.makeToken(MANAGE_SECRET, appt._id, appt.manageNonce) : null; }
function manageUrlFor(business, appt) {
  const token = manageTokenFor(appt);
  return token ? manageLink.manageUrl(PUBLIC_BASE_URL, business.slug, token) : null;
}
/** Manage URL for reminders etc.; gives legacy appointments a nonce on first use. */
async function ensureManageUrl(business, appt) {
  if (!appt.manageNonce) {
    const nonce = manageLink.newNonce();
    const r = await db.collection('appointments').findOneAndUpdate(
      { _id: appt._id, manageNonce: { $exists: false } }, { $set: { manageNonce: nonce } }, { returnDocument: 'after' });
    appt.manageNonce = r ? r.manageNonce : (await db.collection('appointments').findOne({ _id: appt._id }, { projection: { manageNonce: 1 } })).manageNonce;
  }
  return manageUrlFor(business, appt);
}

// ============ APPOINTMENTS ============

// List appointments — PROTECTED (only owner)
app.get('/api/businesses/:slug/appointments', requireOwner, async (req, res) => {
  try {
    const query = { businessId: bizIdFilter(req.business) };
    if (req.query.date) {
      query.date = sanitizeQuery(req.query.date);
    } else {
      if (req.query.from) query.date = { $gte: sanitizeQuery(req.query.from) };
      if (req.query.to) query.date = { ...(query.date || {}), $lte: sanitizeQuery(req.query.to) };
    }
    if (req.query.status) query.status = sanitizeQuery(req.query.status);

    const appointments = await db.collection('appointments').find(query).toArray();
    appointments.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime).localeCompare(String(b.startTime)));
    res.json(appointments.map(apptOut));
  } catch (err) {
    console.error('List appointments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Book appointment — PUBLIC (with booking token + rate limit) or by the owner (Bearer token)
app.post('/api/businesses/:slug/appointments', bookingLimiter, async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const body = req.body || {};
    // Owner booking only when the token is valid AND belongs to this exact business.
    let isOwner = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
        if (decoded.businessId === business._id.toString()) isOwner = true;
      } catch {}
    }

    // Verify booking token only for public (non-owner) bookings
    if (!isOwner && !(await consumeBookingToken(body.bookingToken, business.slug))) {
      return res.status(403).json({ error: 'Invalid or expired booking token', code: 'booking_token' });
    }

    const appointment = await createAppointment(business, body, { isOwner });
    res.status(201).json({ ...apptOut(appointment), manageToken: manageTokenFor(appointment), manageUrl: manageUrlFor(business, appointment) });
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('Book appointment error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update appointment — PROTECTED
app.put('/api/businesses/:slug/appointments/:id', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const { status, notes, confirmationNote, cancellationReason } = req.body || {};
    const update = {};
    if (status !== undefined) {
      if (!APPOINTMENT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      update.status = status;
    }
    if (notes !== undefined) update.notes = notes;
    if (confirmationNote !== undefined) update.confirmationNote = confirmationNote;
    if (cancellationReason !== undefined) update.cancellationReason = cancellationReason;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });

    // Re-activating a cancelled/declined appointment (e.g. "Undo" in the dashboard, H-14/M-16)
    // must not create a double booking if the slot was taken in the meantime.
    if (update.status && !INACTIVE_STATUSES.includes(update.status)) {
      const cur = await db.collection('appointments').findOne(ownedFilter(business, req.params.id));
      if (!cur) return res.status(404).json({ error: 'Appointment not found' });
      const range = INACTIVE_STATUSES.includes(cur.status) ? apptRange(cur) : null;
      if (range) {
        const others = await dayAppointments(business, cur.date, cur._id);
        const clash = others.some(o => (cur.staffId ? (!o.staffId || String(o.staffId) === String(cur.staffId)) : true) && overlaps(o, range.start, range.end));
        if (clash) return res.status(409).json({ error: 'Time slot already booked', code: 'conflict' });
      }
    }

    const result = await db.collection('appointments').findOneAndUpdate(
      ownedFilter(business, req.params.id),
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Appointment not found' });

    if (status === 'cancelled') {
      void notifyBusiness(business._id, {
        titleKey: 'cancelled_title',
        bodyKey: 'cancelled_body',
        payload: {
          customerName: result.customerName,
          serviceName: result.serviceName,
          date: result.date,
          time: result.startTime,
        },
        url: '/(dashboard)/appointments',
      }).catch(() => {});
    }

    res.json(apptOut(result));
  } catch (err) {
    console.error('Update appointment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel appointment — PROTECTED
app.delete('/api/businesses/:slug/appointments/:id', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const { cancellationReason } = req.body || {};
    const update = { status: 'cancelled' };
    if (isStr(cancellationReason) && cancellationReason) update.cancellationReason = cancellationReason;

    const result = await db.collection('appointments').findOneAndUpdate(
      ownedFilter(business, req.params.id),
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Appointment not found' });

    void notifyBusiness(business._id, {
      titleKey: 'cancelled_title',
      bodyKey: 'cancelled_body',
      payload: {
        customerName: result.customerName,
        serviceName: result.serviceName,
        date: result.date,
        time: result.startTime,
      },
      url: '/(dashboard)/appointments',
    }).catch(() => {});

    res.json({ success: true, appointment: apptOut(result) });
  } catch (err) {
    console.error('Cancel appointment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ RESCHEDULE (PROTECTED) ============

app.post('/api/businesses/:slug/appointments/:id/reschedule', requireOwner, async (req, res) => {
  try {
    const { requestedDate, requestedTime, reason } = req.body || {};
    if (!isNonEmptyStr(requestedDate) || !isNonEmptyStr(requestedTime)) {
      return res.status(400).json({ error: 'requestedDate and requestedTime are required' });
    }
    if (!T.isValidYMD(requestedDate) || !T.isValidHM(requestedTime)) {
      return res.status(400).json({ error: 'Invalid requestedDate/requestedTime format' });
    }

    const rescheduleRequest = {
      _id: new ObjectId(),
      requestedDate,
      requestedTime,
      reason: isStr(reason) ? reason : '',
      status: 'pending',
      createdAt: new Date()
    };

    const result = await db.collection('appointments').findOneAndUpdate(
      ownedFilter(req.business, req.params.id),
      { $set: { status: 'reschedule_requested', rescheduleRequest } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Appointment not found' });
    res.json(apptOut(result));
  } catch (err) {
    console.error('Reschedule request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/businesses/:slug/appointments/:id/reschedule/:requestId', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const { action } = req.body || {};
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'action must be accept or decline' });
    }

    const filter = ownedFilter(business, req.params.id);
    const appointment = await db.collection('appointments').findOne(filter);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    const rr = appointment.rescheduleRequest;
    if (!rr || String(rr._id) !== req.params.requestId) return res.status(404).json({ error: 'Reschedule request not found' });
    if (rr.status && rr.status !== 'pending') return res.status(400).json({ error: 'Reschedule request already handled' });

    let update;
    if (action === 'accept') {
      const date = rr.requestedDate, startTime = rr.requestedTime;
      if (!T.isValidYMD(date) || !T.isValidHM(startTime)) return res.status(400).json({ error: 'Invalid requested date/time' });
      const range = apptRange(appointment);
      const svc = findService(business, String(appointment.serviceId || ''));
      const duration = Number(appointment.duration) || (range ? range.end - range.start : 0) || (svc && Number(svc.duration)) || 30;
      const start = T.hmToMin(startTime), end = start + duration;
      if (end > 24 * 60) return res.status(400).json({ error: 'Appointment must end by midnight' });
      const now = T.nowInTz(T.businessTz(business));
      if (date < now.date) return res.status(400).json({ error: 'Cannot move an appointment into the past' });
      const others = await dayAppointments(business, date, appointment._id);
      const conflict = others.some(a => {
        if (appointment.staffId) return (!a.staffId || String(a.staffId) === String(appointment.staffId)) && overlaps(a, start, end);
        return overlaps(a, start, end);
      });
      if (conflict) return res.status(409).json({ error: 'Time slot already booked' });
      update = { $set: { date, startTime, endTime: T.minToHM(end), status: 'confirmed', 'rescheduleRequest.status': 'accepted', 'rescheduleRequest.respondedAt': new Date(), 'rescheduleRequest.previousDate': appointment.date, 'rescheduleRequest.previousTime': appointment.startTime } };
    } else {
      update = { $set: { status: rr.previousStatus && !INACTIVE_STATUSES.includes(rr.previousStatus) ? rr.previousStatus : 'confirmed', 'rescheduleRequest.status': 'declined', 'rescheduleRequest.respondedAt': new Date() } };
    }

    const result = await db.collection('appointments').findOneAndUpdate(filter, update, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'Appointment not found' });
    res.json(apptOut(result));
  } catch (err) {
    console.error('Reschedule response error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ CUSTOMER MANAGE LINK (PUBLIC, H-5) ============
// /api/manage/:token — the token is an HMAC-signed link sent to the customer only
// (booking response, WhatsApp share, calendar invite, reminders).

const ACTIVE_STATUSES = ['pending', 'confirmed', 'reschedule_requested'];
const DEFAULT_CANCEL_CUTOFF_H = (() => { const n = Number(process.env.CANCEL_CUTOFF_HOURS_DEFAULT); return Number.isFinite(n) && n >= 0 ? n : 0; })();

function bookingPolicyOf(business) {
  const bp = business.bookingPolicy || {};
  const cutoff = Number(bp.cancelCutoffHours);
  return {
    cancelCutoffHours: Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : DEFAULT_CANCEL_CUTOFF_H,
    allowCustomerCancel: bp.allowCustomerCancel !== false,
    allowCustomerReschedule: bp.allowCustomerReschedule !== false,
  };
}

function manageState(business, appt) {
  const policy = bookingPolicyOf(business);
  const tz = T.businessTz(business);
  const startMs = T.isValidYMD(appt.date) && T.isValidHM(appt.startTime) ? T.zonedTimeToUtcMs(appt.date, appt.startTime, tz) : 0;
  const nowMs = Date.now();
  let reason = null;
  if (!ACTIVE_STATUSES.includes(appt.status)) reason = appt.status; // cancelled / declined / completed / no_show
  else if (startMs <= nowMs) reason = 'past';
  else if (startMs - nowMs < policy.cancelCutoffHours * 3600 * 1000) reason = 'cutoff';
  const serviceExists = !!findService(business, String(appt.serviceId || ''));
  return {
    ...policy,
    canCancel: !reason && policy.allowCustomerCancel,
    canReschedule: !reason && policy.allowCustomerReschedule && serviceExists,
    reason: reason || (!policy.allowCustomerCancel && !policy.allowCustomerReschedule ? 'not_allowed' : null),
  };
}

function manageView(business, appt) {
  const rr = appt.rescheduleRequest;
  return {
    appointment: {
      id: appt._id.toString(),
      serviceId: String(appt.serviceId || ''),
      serviceName: appt.serviceName,
      staffId: appt.staffId || '',
      staffName: appt.staffName || '',
      date: appt.date,
      startTime: appt.startTime,
      endTime: appt.endTime,
      duration: appt.duration,
      price: appt.price,
      status: appt.status,
      customerName: appt.customerName,
      cancelledBy: appt.cancelledBy || null,
      rescheduleRequest: rr ? { requestedDate: rr.requestedDate, requestedTime: rr.requestedTime, status: rr.status || 'pending', requestedBy: rr.requestedBy || null } : null,
    },
    business: {
      name: business.name, slug: business.slug, theme: business.theme, type: business.type,
      timezone: T.businessTz(business), workingHours: business.workingHours,
    },
    policy: manageState(business, appt),
    manageUrl: manageUrlFor(business, appt),
  };
}

const manageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: intEnv('MANAGE_RATE_LIMIT', 120),
  message: { error: 'Too many requests. Try again later.' },
  validate: false,
  keyGenerator: (req) => 'ip:' + clientIp(req),
});

async function loadManaged(req, res, next) {
  try {
    const t = manageLink.parse(req.params.token);
    if (!t) return res.status(404).json({ error: 'Link not found', code: 'invalid_link' });
    const appt = await db.collection('appointments').findOne({ _id: new ObjectId(t.id) });
    if (!appt || !manageLink.verify(MANAGE_SECRET, appt, t.sig)) return res.status(404).json({ error: 'Link not found', code: 'invalid_link' });
    const business = await db.collection('businesses').findOne({ _id: toObjectId(String(appt.businessId)) });
    if (!business) return res.status(404).json({ error: 'Link not found', code: 'invalid_link' });
    req.appt = appt;
    req.business = business;
    next();
  } catch (err) { next(err); }
}

app.get('/api/manage/:token', manageLimiter, loadManaged, (req, res) => {
  res.json(manageView(req.business, req.appt));
});

app.get('/api/manage/:token/availability', manageLimiter, loadManaged, async (req, res) => {
  try {
    const date = isStr(req.query.date) ? req.query.date : '';
    if (!T.isValidYMD(date)) return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
    const a = req.appt;
    res.json(await computeAvailability(req.business, { date, serviceId: String(a.serviceId || ''), staffId: a.staffId || '', excludeId: a._id }));
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('Manage availability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/manage/:token/cancel', manageLimiter, loadManaged, async (req, res) => {
  try {
    const { business, appt } = req;
    const state = manageState(business, appt);
    if (!state.canCancel) return res.status(409).json({ error: 'This appointment can no longer be cancelled online', code: `cannot_cancel_${state.reason || 'not_allowed'}` });
    const reason = isStr(req.body && req.body.reason) ? req.body.reason.slice(0, 300) : '';
    const set = { status: 'cancelled', cancelledBy: 'customer', cancelledAt: new Date(), cancellationReason: reason };
    if (appt.rescheduleRequest && (appt.rescheduleRequest.status || 'pending') === 'pending') set['rescheduleRequest.status'] = 'withdrawn';
    const updated = await db.collection('appointments').findOneAndUpdate(
      { _id: appt._id, status: { $in: ACTIVE_STATUSES } }, { $set: set }, { returnDocument: 'after' });
    if (!updated) return res.status(409).json({ error: 'This appointment was already changed', code: 'cannot_cancel_changed' });
    void notifyBusiness(business._id, {
      titleKey: 'cancelled_title', bodyKey: 'cancelled_body',
      payload: { customerName: updated.customerName, serviceName: updated.serviceName, date: updated.date, time: updated.startTime },
      url: '/(dashboard)/appointments',
    }).catch(() => {});
    console.log(`[manage] customer cancelled appt=${appt._id} biz=${business.slug}`);
    res.json(manageView(business, updated));
  } catch (err) {
    console.error('Manage cancel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/manage/:token/reschedule', manageLimiter, loadManaged, async (req, res) => {
  try {
    const { business, appt } = req;
    const state = manageState(business, appt);
    if (!state.canReschedule) return res.status(409).json({ error: 'This appointment can no longer be changed online', code: `cannot_reschedule_${state.reason || 'not_allowed'}` });
    const { date, startTime, reason } = req.body || {};
    if (date === appt.date && startTime === appt.startTime) return res.status(400).json({ error: 'Pick a different time', code: 'same_time' });
    const lim = await mongoLimit.hit(db, `manage-resched:${appt._id}`, 10, 24 * 60 * 60 * 1000);
    if (!lim.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    await checkSlot(business, { serviceId: String(appt.serviceId || ''), staffId: appt.staffId || undefined, date, startTime }, { isOwner: false, excludeId: appt._id });
    const previousStatus = appt.status === 'reschedule_requested'
      ? ((appt.rescheduleRequest && appt.rescheduleRequest.previousStatus) || 'pending') : appt.status;
    const rescheduleRequest = {
      _id: new ObjectId(), requestedDate: date, requestedTime: startTime,
      reason: isStr(reason) ? reason.slice(0, 300) : '', status: 'pending', requestedBy: 'customer', previousStatus, createdAt: new Date(),
    };
    const updated = await db.collection('appointments').findOneAndUpdate(
      { _id: appt._id, status: { $in: ACTIVE_STATUSES } },
      { $set: { status: 'reschedule_requested', rescheduleRequest } }, { returnDocument: 'after' });
    if (!updated) return res.status(409).json({ error: 'This appointment was already changed', code: 'cannot_reschedule_changed' });
    void notifyBusiness(business._id, {
      titleKey: 'reschedule_title', bodyKey: 'reschedule_body',
      payload: { customerName: updated.customerName, serviceName: updated.serviceName, date, time: startTime },
      url: '/(dashboard)',
    }).catch(() => {});
    console.log(`[manage] reschedule requested appt=${appt._id} biz=${business.slug}`);
    res.json(manageView(business, updated));
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('Manage reschedule error:', err);
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
      .find({ businessId: bizIdFilter(business), isActive: true })
      .toArray();
    announcements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(announcements.map(apptOut));
  } catch (err) {
    console.error('Get announcements error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create announcement — PROTECTED
app.post('/api/businesses/:slug/announcements', requireOwner, async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!isNonEmptyStr(message)) return res.status(400).json({ error: 'Message is required' });

    const announcement = { businessId: req.business._id, message, isActive: true, createdAt: new Date() };
    const result = await db.collection('announcements').insertOne(announcement);
    announcement._id = result.insertedId;
    res.status(201).json(apptOut(announcement));
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete announcement — PROTECTED
app.delete('/api/businesses/:slug/announcements/:id', requireOwner, async (req, res) => {
  try {
    const result = await db.collection('announcements').findOneAndUpdate(
      ownedFilter(req.business, req.params.id),
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

app.get('/api/businesses/:slug/customers', requireOwner, async (req, res) => {
  try {
    const query = { businessId: bizIdFilter(req.business) };
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
    res.json(customers.map(apptOut));
  } catch (err) {
    console.error('List customers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/businesses/:slug/customers/groups', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const bid = bizIdFilter(business);
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000);
    const threeMonthsAgo = new Date(now - 90 * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const [all, recent, inactive, newC, vip] = await Promise.all([
      db.collection('customers').countDocuments({ businessId: bid }),
      db.collection('customers').countDocuments({ businessId: bid, lastVisit: { $gte: thirtyDaysAgo } }),
      db.collection('customers').countDocuments({ businessId: bid, $or: [{ lastVisit: { $lt: threeMonthsAgo } }, { lastVisit: null }] }),
      db.collection('customers').countDocuments({ businessId: bid, createdAt: { $gte: monthStart } }),
      db.collection('customers').countDocuments({ businessId: bid, isVip: true }),
      db.collection('customers').countDocuments({ businessId: bid, birthday: mmdd }),
    ]);

    const cancelled = await db.collection('appointments').countDocuments({
      businessId: bid, status: 'cancelled',
      date: { $gte: T.addDays(T.todayInTz(T.businessTz(business)), -30) }
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

app.post('/api/businesses/:slug/customers', requireOwner, async (req, res) => {
  try {
    const { name, phone, email, notes, birthday } = req.body || {};
    if (!isNonEmptyStr(name) || !isNonEmptyStr(phone)) return res.status(400).json({ error: 'Name and phone are required' });

    const customer = {
      businessId: req.business._id.toString(),
      name, phone, email: isStr(email) ? email : '', notes: isStr(notes) ? notes : '',
      isVip: false, tags: [], totalVisits: 0, totalSpent: 0,
      lastVisit: null, birthday: isStr(birthday) ? birthday : '', createdAt: new Date(),
    };

    const result = await db.collection('customers').insertOne(customer);
    customer._id = result.insertedId;
    res.status(201).json(apptOut(customer));
  } catch (err) {
    console.error('Create customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/businesses/:slug/customers/:id', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const customer = await db.collection('customers').findOne(ownedFilter(business, req.params.id));
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const visits = await db.collection('appointments')
      .find({ businessId: bizIdFilter(business), customerPhone: customer.phone, status: { $in: ['confirmed', 'completed'] } })
      .toArray();
    visits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    res.json({ ...apptOut(customer), visits: visits.slice(0, 50).map(apptOut) });
  } catch (err) {
    console.error('Get customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/businesses/:slug/customers/:id', requireOwner, async (req, res) => {
  try {
    const { name, phone, email, notes, isVip, tags, birthday } = req.body || {};
    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (notes !== undefined) update.notes = notes;
    if (isVip !== undefined) update.isVip = isVip === true;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags.filter(isStr) : [];
    if (birthday !== undefined) update.birthday = birthday;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });

    const result = await db.collection('customers').findOneAndUpdate(
      ownedFilter(req.business, req.params.id),
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Customer not found' });
    res.json(apptOut(result));
  } catch (err) {
    console.error('Update customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ TASKS (ALL PROTECTED) ============

app.get('/api/businesses/:slug/tasks', requireOwner, async (req, res) => {
  try {
    const query = { businessId: bizIdFilter(req.business) };
    if (req.query.filter === 'active') query.completed = false;
    else if (req.query.filter === 'completed') query.completed = true;

    const tasks = await db.collection('tasks').find(query).toArray();
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(tasks.map(apptOut));
  } catch (err) {
    console.error('List tasks error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/businesses/:slug/tasks', requireOwner, async (req, res) => {
  try {
    const { text, dueDate } = req.body || {};
    if (!isNonEmptyStr(text)) return res.status(400).json({ error: 'Text is required' });

    const task = {
      businessId: req.business._id.toString(),
      text, dueDate: dueDate || null,
      completed: false, completedAt: null, createdAt: new Date(),
    };

    const result = await db.collection('tasks').insertOne(task);
    task._id = result.insertedId;
    res.status(201).json(apptOut(task));
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/businesses/:slug/tasks/:id', requireOwner, async (req, res) => {
  try {
    const { text, dueDate, completed } = req.body || {};
    const update = {};
    if (text !== undefined) update.text = text;
    if (dueDate !== undefined) update.dueDate = dueDate;
    if (completed !== undefined) { update.completed = completed === true; update.completedAt = completed === true ? new Date() : null; }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });

    const result = await db.collection('tasks').findOneAndUpdate(
      ownedFilter(req.business, req.params.id),
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Task not found' });
    res.json(apptOut(result));
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/businesses/:slug/tasks/:id', requireOwner, async (req, res) => {
  try {
    const result = await db.collection('tasks').deleteOne(ownedFilter(req.business, req.params.id));
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ STAFF ============

// Get staff — PUBLIC (for booking flow)
app.get('/api/businesses/:slug/staff', async (req, res) => {
  try {
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json((business.staff || []).filter(s => s.isActive !== false).map(publicStaff));
  } catch (err) {
    console.error('Get staff error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update staff — PROTECTED
app.put('/api/businesses/:slug/staff', requireOwner, async (req, res) => {
  try {
    const { staff } = req.body || {};
    if (!Array.isArray(staff)) return res.status(400).json({ error: 'staff must be an array' });

    const staffWithIds = cleanStaffList(staff, req.business.staff);

    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: req.business._id },
      { $set: { staff: staffWithIds } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.json(normalizeBusiness(result));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, code: err.code });
    console.error('Update staff error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ AVAILABILITY (PUBLIC) ============

/**
 * Slots for a day. Returns the response body (same shape as before).
 * excludeId: ignore this appointment (customer moving their own booking).
 */
async function computeAvailability(business, { date, serviceId, staffId, excludeId }) {
  const tz = T.businessTz(business);
  const now = T.nowInTz(tz);
  const dayOfWeek = T.dayNameOf(date);
  const closed = (message, extra = {}) => ({ date, dayOfWeek, available: false, slots: [], availableServices: [], availableStaff: [], message, ...extra });

  if (date < now.date) return closed('Date is in the past', { reason: 'past' });
  const bizHours = businessDayHours(business, dayOfWeek);
  if (!bizHours) return closed('Business closed on this day', { reason: 'closed' });
  const rawDay = business.workingHours[dayOfWeek];
  const breaks = dayBreaks(bizHours);

  const service = serviceId ? findService(business, serviceId) : null;
  if (serviceId && !service) throw new BookingError(400, 'Service not found', 'service_not_found');
  const svcKey = service ? serviceKey(service) : null;
  if (svcKey && !perDayServiceAllowed(rawDay, svcKey)) return closed('Service not available on this day', { reason: 'service_unavailable_day' });

  const slotDuration = service && validDuration(service.duration) ? Number(service.duration) : 30;
  const appts = await dayAppointments(business, date, excludeId);
  const staffAll = activeStaff(business);

  let staffMember = null;
  let window = { start: bizHours.start, end: bizHours.end };
  let eligible = [];
  if (staffId) {
    staffMember = (business.staff || []).find(s => s && s._id && s._id.toString() === staffId && s.isActive !== false);
    if (!staffMember) throw new BookingError(400, 'Staff member not found', 'staff_not_found');
    const h = staffDayHours(staffMember, dayOfWeek, bizHours);
    if (!h) return closed('Staff member not available on this day', { reason: 'staff_day_off' });
    if (svcKey && !staffProvides(staffMember, svcKey)) return closed('Staff member does not provide this service', { reason: 'staff_service' });
    window = { start: Math.max(h.start, bizHours.start), end: Math.min(h.end, bizHours.end) };
  } else if (staffAll.length > 0) {
    eligible = staffAll.filter(sm => (!svcKey || staffProvides(sm, svcKey)) && staffDayHours(sm, dayOfWeek, bizHours));
    if (!eligible.length) return closed('No staff available on this day', { reason: 'no_staff' });
  }

  const slots = [];
  for (let m = window.start; m + slotDuration <= window.end; m += slotDuration) {
    const start = m, end = m + slotDuration;
    if (inBreak(breaks, start, end)) continue; // breaks are not bookable (H-9)
    let available;
    if (date === now.date && start <= now.minutes) available = false;
    else if (staffMember) available = !appts.some(a => a.staffId && String(a.staffId) === staffId && overlaps(a, start, end));
    else if (eligible.length) available = freeStaff(eligible, appts, start, end, { dayName: dayOfWeek, bizHours, enforceHours: true }).length > 0;
    else available = !appts.some(a => overlaps(a, start, end));
    slots.push({ start: T.minToHM(start), end: T.minToHM(end), available });
  }

  const allowedIds = rawDay && rawDay.serviceMode === 'custom' && Array.isArray(rawDay.enabledServices)
    ? rawDay.enabledServices.map(String) : null;
  const availableServices = (business.services || [])
    .filter(s => !allowedIds || allowedIds.includes(serviceKey(s)))
    .map(publicService);
  const availableStaff = staffAll
    .filter(s => staffDayHours(s, dayOfWeek, bizHours) && (!svcKey || staffProvides(s, svcKey)))
    .map(s => ({ _id: s._id, id: s._id.toString(), name: s.name, role: s.role }));

  return { date, dayOfWeek, available: slots.some(s => s.available), slots, availableServices, availableStaff };
}

app.get('/api/businesses/:slug/availability', async (req, res) => {
  try {
    const date = isStr(req.query.date) ? req.query.date : '';
    const staffId = isStr(req.query.staffId) ? req.query.staffId : '';
    const serviceId = isStr(req.query.serviceId) ? req.query.serviceId : '';
    if (!date) return res.status(400).json({ error: 'Date parameter required (YYYY-MM-DD)' });
    if (!T.isValidYMD(date)) return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
    const business = await getBusinessBySlug(req.params.slug);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json(await computeAvailability(business, { date, serviceId, staffId }));
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ STATS (PROTECTED) ============

app.get('/api/businesses/:slug/stats', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const bid = bizIdFilter(business);
    const now = new Date();
    const weekAgoStr = T.addDays(T.todayInTz(T.businessTz(business)), -7);

    const [weekAppts, weekCancelled, weekCustomers] = await Promise.all([
      db.collection('appointments').countDocuments({ businessId: bid, date: { $gte: weekAgoStr } }),
      db.collection('appointments').countDocuments({ businessId: bid, status: 'cancelled', date: { $gte: weekAgoStr } }),
      db.collection('customers').countDocuments({ businessId: bid, createdAt: { $gte: new Date(now - 7 * 86400000) } })
    ]);

    const confirmed = await db.collection('appointments').find({
      businessId: bid, status: 'confirmed', date: { $gte: weekAgoStr }
    }).toArray();
    let revenue = 0;
    for (const appt of confirmed) {
      if (typeof appt.price === 'number') { revenue += appt.price; continue; }
      const svc = business.services?.find(s => s._id?.toString() === String(appt.serviceId) || s.name === appt.serviceName);
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
app.get('/api/businesses/:slug/stats/extended', requireOwner, async (req, res) => {
  try {
    const business = req.business;
    const bid = bizIdFilter(business);
    const now = new Date();
    const today = T.todayInTz(T.businessTz(business));
    const monthStart = today.slice(0, 8) + '01';

    const monthAppts = await db.collection('appointments').find({
      businessId: bid, date: { $gte: monthStart }, status: { $ne: 'cancelled' }
    }).toArray();

    let monthRevenue = 0;
    const dayCount = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    for (const a of monthAppts) {
      if (a.status === 'confirmed') {
        if (typeof a.price === 'number') monthRevenue += a.price;
        else {
          const svc = business.services?.find(s => s._id?.toString() === String(a.serviceId) || s.name === a.serviceName);
          if (svc) monthRevenue += svc.price || 0;
        }
      }
      if (T.isValidYMD(a.date)) dayCount[T.DAY_NAMES.indexOf(T.dayNameOf(a.date))]++;
    }

    const monthCustomers = await db.collection('customers').countDocuments({
      businessId: bid, createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) }
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
// Scheduler endpoints require the X-Cron-Secret header (= REMINDER_CRON_SECRET app setting).
// The old open /api/reminders/send relay has been removed.

// Run one scheduler pass now (push + customer reminders when a provider is configured)
app.post('/api/reminders/process', requireCronSecret, async (req, res) => {
  try {
    const result = await reminders.runOnce({ db, notifyBusiness, reminderService });
    res.json(result);
  } catch (err) {
    console.error('Reminders process error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// External cron (VM): returns due customer reminders and fires owner push reminders.
app.post('/api/reminders/check', requireCronSecret, async (req, res) => {
  try {
    const due = await reminders.findDue(db);
    await reminders.sendPushes(db, due, notifyBusiness);
    const list = reminders.toCheckPayload(due);
    res.json({ reminders: list, count: list.length });
  } catch (err) {
    console.error('Reminders check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark reminder as sent (external cron)
app.post('/api/reminders/mark-sent', requireCronSecret, async (req, res) => {
  try {
    const { appointmentId, intervalKey } = req.body || {};
    if (!appointmentId || !intervalKey) return res.status(400).json({ error: 'Missing appointmentId or intervalKey' });
    const oid = toObjectId(String(appointmentId));
    if (!oid) return res.status(400).json({ error: 'Invalid appointmentId' });
    if (!reminders.VALID_KEYS.has(intervalKey)) return res.status(400).json({ error: 'Invalid intervalKey' });

    const r = await db.collection('appointments').updateOne(
      { _id: oid },
      { $set: { [`reminders.${intervalKey}`]: true } }
    );
    if (r.matchedCount === 0) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark reminder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get reminder history for a business
app.get('/api/businesses/:slug/reminders', requireOwner, async (req, res) => {
  try {
    const appointments = await db.collection('appointments').find({
      businessId: bizIdFilter(req.business),
      'reminders': { $exists: true },
    }).sort({ date: -1 }).limit(50).toArray();

    const history = appointments.map(a => ({
      appointmentId: a._id.toString(),
      customerName: a.customerName,
      customerPhone: a.customerPhone,
      date: a.date,
      startTime: a.startTime,
      reminders: a.reminders || {},
    }));

    res.json(history);
  } catch (err) {
    console.error('Reminder history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ ADMIN ============

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (!decoded.admin) return res.status(401).json({ error: 'Not admin' });
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin login disabled (ADMIN_PASSWORD not set)' });
  const { password } = req.body || {};
  const ok = isStr(password) && crypto.timingSafeEqual(sha256(password), sha256(ADMIN_PASSWORD));
  if (!ok) {
    console.warn(`[admin] failed login ip=${clientIp(req)}`);
    return res.status(401).json({ error: 'Wrong password' });
  }
  console.log(`[admin] login ip=${clientIp(req)}`);
  const token = jwt.sign({ admin: true }, ADMIN_JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

app.get('/api/admin/data', adminAuth, async (req, res) => {
  try {
    const [businesses, customers, appointments] = await Promise.all([
      db.collection('businesses').find({}).toArray(),
      db.collection('customers').find({}).toArray(),
      db.collection('appointments').find({}).toArray().then(a => a.sort((x,y) => (String(y.date)+y.startTime).localeCompare(String(x.date)+x.startTime)).slice(0, 200)),
    ]);
    // Convert ObjectIds to strings for frontend matching
    businesses.forEach(b => { b._id = b._id.toString(); });
    appointments.forEach(a => { a._id = a._id.toString(); a.businessId = a.businessId?.toString(); delete a.manageNonce; });
    res.json({ businesses, customers, appointments });
  } catch (err) {
    console.error('Admin data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/businesses/:id', adminAuth, async (req, res) => {
  try {
    const bid = new ObjectId(req.params.id);
    const { name, phone, type, slug } = req.body || {};
    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (type !== undefined) update.type = type;
    if (slug !== undefined) {
      if (!isNonEmptyStr(slug)) return res.status(400).json({ error: 'Invalid slug' });
      const s = slug.toLowerCase().trim();
      const existing = await db.collection('businesses').findOne({ slug: s, _id: { $ne: bid } });
      if (existing) return res.status(400).json({ error: 'Slug already exists' });
      update.slug = s;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
    const r = await db.collection('businesses').updateOne({ _id: bid }, { $set: update });
    if (r.matchedCount === 0) return res.status(404).json({ error: 'Business not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Admin edit business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/admin/businesses/:id/toggle', adminAuth, async (req, res) => {
  try {
    const bid = new ObjectId(req.params.id);
    const business = await db.collection('businesses').findOne({ _id: bid });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const newState = !(business.isActive !== false);
    await db.collection('businesses').updateOne({ _id: bid }, { $set: { isActive: newState } });
    res.json({ success: true, isActive: newState });
  } catch (err) {
    console.error('Admin toggle business error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/businesses/:id', adminAuth, async (req, res) => {
  try {
    const bid = req.params.id;
    const bidObj = new ObjectId(bid);
    const business = await db.collection('businesses').findOne({ _id: bidObj });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    await Promise.all([
      db.collection('businesses').deleteOne({ _id: bidObj }),
      db.collection('appointments').deleteMany({ businessId: { $in: [bidObj, bid] } }),
      db.collection('customers').deleteMany({ businessId: { $in: [bidObj, bid] } }),
      db.collection('tasks').deleteMany({ businessId: { $in: [bidObj, bid] } }),
      db.collection('announcements').deleteMany({ businessId: { $in: [bidObj, bid] } }),
      db.collection('push_tokens').deleteMany({ business_id: bid }),
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

// Unknown API routes → JSON 404 (instead of hanging)
app.all('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback — must be LAST
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Last-resort error handler (e.g. DB errors thrown inside middleware)
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ START ============

let scheduler = null;
reminders.setManageUrlBuilder((biz, appt) => ensureManageUrl(biz, appt));

function startBackground() {
  const mode = String(process.env.REMINDER_SCHEDULER || (IS_PROD ? 'on' : 'off')).toLowerCase();
  if (mode !== 'off' && mode !== 'false' && mode !== '0') {
    scheduler = reminders.startScheduler({ getDb: () => db, notifyBusiness, reminderService, intervalMs: intEnv('REMINDER_INTERVAL_MS', 60000) });
  }
  if (otpFlagOn() && !otpSender.configured) {
    console.error('[auth] AUTH_OTP_REQUIRED=true but no OTP provider is configured — OTP is NOT enforced (legacy phone login stays on). See lib/otp-sender.js.');
  }
  console.log(`[auth] login mode: ${otpEnabled() ? `OTP via ${otpSender.name}` : 'legacy phone-only (OTP off)'}; token TTL ${TOKEN_TTL}`);
  if (!process.env.REMINDER_CRON_SECRET) console.warn('[reminders] REMINDER_CRON_SECRET not set — /api/reminders/* endpoints are disabled');
  if (!ADMIN_PASSWORD) console.warn('[admin] ADMIN_PASSWORD not set — admin login disabled');
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`PickTime running on port ${PORT}`));
    startBackground();
  }).catch(err => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });
}

module.exports = {
  app, connectDB, client,
  getDb: () => db,
  setOtpSender: (s) => { otpSender = s; },
  getOtpSender: () => otpSender,
  JWT_SECRET,
  _internals: { phoneKey, phoneVariants, toObjectId, createAppointment, slugProblem, cleanWorkingHours, manageTokenFor, MANAGE_SECRET },
};
