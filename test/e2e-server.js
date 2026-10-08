'use strict';
// Local end-to-end server for the Snaptor web Playwright tests.
// Starts an in-memory MongoDB, seeds QA businesses, serves the built web app from
// public/ (same as production) and listens on PORT (default 3999).
// Writes the seed (slugs, service/staff ids, owner token) to E2E_SEED_FILE.
//   node test/e2e-server.js
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'picktime_e2e',
    JWT_SECRET: process.env.JWT_SECRET || 'e2e-jwt-secret',
    REMINDER_CRON_SECRET: 'e2e-cron-secret',
    ADMIN_PASSWORD: 'e2e-admin-password',
    API_RATE_LIMIT: '100000',
    BOOKING_RATE_LIMIT: '100000',
    CREATE_BUSINESS_RATE_LIMIT: '100000',
    LOGIN_RATE_LIMIT: '100000',
    OTP_VERIFY_RATE_LIMIT: '100000',
    REMINDER_SCHEDULER: 'off',
  });
  const request = require('supertest');
  const T = require('../lib/time');
  const srv = require('../server');
  await srv.connectDB();
  const api = request(srv.app);
  // E2E_OTP=1: OTP login on, codes written to a local file instead of being texted.
  const otpFile = process.env.E2E_OTP_FILE || path.join(__dirname, '.e2e-otp.json');
  if (process.env.E2E_OTP === '1') {
    process.env.AUTH_OTP_REQUIRED = 'true';
    srv.setOtpSender({ name: 'e2e-file', configured: true, send: async (phone, code) => { fs.writeFileSync(otpFile, JSON.stringify({ phone, code })); } });
  }

  // Open every day except Saturday (closed), 08:00–20:00
  const hours = Object.fromEntries(T.DAY_NAMES.map(d => [d, { start: '08:00', end: '20:00', enabled: d !== 'saturday' }]));
  const services = [
    { id: '1', name: 'QA Haircut', duration: 30, price: 60 },
    { id: '2', name: 'QA Beard', duration: 45, price: 80 },
    { id: String(Date.now()), name: 'QA Color', duration: 60, price: 120 },
  ];
  async function mk(slug, phone) {
    const r = await api.post('/api/businesses').send({ name: `QA Test ${slug}`, slug, type: 'barber', phone, workingHours: hours, services });
    if (r.status !== 201) throw new Error('seed failed ' + r.status + JSON.stringify(r.body));
    return r.body;
  }
  const solo = await mk('qa-test-solo', '0500000901');
  const team = await mk('qa-test-team', '0500000902');
  const teamAuth = { Authorization: `Bearer ${team.token}` };
  const colorId = team.services[2]._id;
  const st = await api.put(`/api/businesses/${team.slug}/staff`).set(teamAuth).send({
    staff: [
      { name: 'QA Dana', role: 'Stylist', isActive: true, services: [] },
      { name: 'QA Avi', role: 'Colorist', isActive: true, services: [String(colorId)] },
    ],
  });
  if (st.status !== 200) throw new Error('staff seed failed ' + st.status);

  const seed = {
    otpFile: process.env.E2E_OTP === '1' ? otpFile : null,
    solo: { slug: solo.slug, token: solo.token, services: solo.services.map(s => ({ id: String(s._id), name: s.name })) },
    team: {
      slug: team.slug, token: team.token,
      services: team.services.map(s => ({ id: String(s._id), name: s.name })),
      staff: st.body.staff.map(s => ({ id: String(s._id), name: s.name })),
    },
  };
  const seedFile = process.env.E2E_SEED_FILE || path.join(__dirname, '.e2e-seed.json');
  fs.writeFileSync(seedFile, JSON.stringify(seed, null, 2));

  const port = Number(process.env.PORT || 3999);
  const server = srv.app.listen(port, () => console.log(`[e2e] listening on http://localhost:${port} seed=${seedFile}`));
  const stop = async () => { server.close(); await srv.client.close(); await mongod.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch(err => { console.error(err); process.exit(1); });
