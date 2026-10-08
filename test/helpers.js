'use strict';
// Shared test setup: in-memory MongoDB + the real Express app (no network listener).
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const T = require('../lib/time');

const TZ = 'Asia/Jerusalem';
const ALL_OPEN = Object.fromEntries(T.DAY_NAMES.map(d => [d, { start: '08:00', end: '20:00', enabled: true }]));

async function setup(env = {}) {
  const mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'picktime_test',
    JWT_SECRET: 'test-jwt-secret',
    REMINDER_CRON_SECRET: 'test-cron-secret',
    ADMIN_PASSWORD: 'test-admin-password',
    API_RATE_LIMIT: '100000',
    BOOKING_RATE_LIMIT: '100000',
    CREATE_BUSINESS_RATE_LIMIT: '100000',
    LOGIN_RATE_LIMIT: '100000',
    OTP_VERIFY_RATE_LIMIT: '100000',
    REMINDER_SCHEDULER: 'off',
    ...env,
  });
  const srv = require('../server');
  await srv.connectDB();
  const api = request(srv.app);
  return {
    srv, api, db: srv.getDb(), mongod,
    async teardown() { await srv.client.close(); await mongod.stop(); },
  };
}

let phoneCounter = 0;
function fakePhone() {
  phoneCounter += 1;
  return `05000009${String(phoneCounter).padStart(2, '0')}`;
}

async function createBusiness(api, overrides = {}) {
  const slug = overrides.slug || `qa-test-${Math.random().toString(36).slice(2, 8)}`;
  const res = await api.post('/api/businesses').send({
    name: `QA Test ${slug}`,
    slug,
    type: 'barber',
    phone: overrides.phone || fakePhone(),
    workingHours: ALL_OPEN,
    services: [
      { id: '1', name: 'QA Haircut', duration: 30, price: 60 },
      { id: '2', name: 'QA Haircut + Beard', duration: 45, price: 80 },
      { id: String(Date.now()), name: 'QA Color', duration: 60, price: 120 },
    ],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createBusiness failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, business: res.body, slug: res.body.slug, auth: { Authorization: `Bearer ${res.body.token}` } };
}

async function bookingToken(api, slug) {
  const r = await api.get(`/api/businesses/${slug}/booking-token`);
  if (r.status !== 200) throw new Error('booking token ' + r.status);
  return r.body.token;
}

async function publicBook(api, slug, body) {
  const token = await bookingToken(api, slug);
  return api.post(`/api/businesses/${slug}/appointments`).send({ bookingToken: token, customerName: 'QA Test Customer', customerPhone: '050-000-0990', ...body });
}

function today() { return T.todayInTz(TZ); }
function daysFromToday(n) { return T.addDays(today(), n); }
/** Next date (>= tomorrow) that falls on the given weekday name. */
function nextWeekday(dayName) {
  for (let i = 1; i <= 8; i++) { const d = daysFromToday(i); if (T.dayNameOf(d) === dayName) return d; }
  throw new Error('unreachable');
}

module.exports = { setup, createBusiness, bookingToken, publicBook, fakePhone, today, daysFromToday, nextWeekday, ALL_OPEN, TZ, T };
