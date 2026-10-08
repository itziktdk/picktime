'use strict';
// Phase 2: customer manage link (H-5), working hours + breaks (H-9), phone change (H-12),
// reserved slugs, CSP / CORS / unknown API routes.
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, publicBook, daysFromToday, nextWeekday, fakePhone, ALL_OPEN, T, TZ } = require('./helpers');
const { createSender } = require('../lib/otp-sender');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });
beforeEach(async () => {
  delete process.env.AUTH_OTP_REQUIRED;
  ctx.srv.setOtpSender(createSender({ OTP_PROVIDER: 'none' }));
  await ctx.db.collection('rate_limits').deleteMany({});
});

async function svcOf(slug, i = 0) { return (await ctx.api.get(`/api/businesses/${slug}`)).body.services[i]; }
async function book(slug, date, startTime, i = 0, extra = {}) {
  const svc = await svcOf(slug, i);
  return publicBook(ctx.api, slug, { serviceId: svc.id, date, startTime, ...extra });
}
const tokenOf = (url) => url.split('/manage/')[1];

describe('manage link (H-5)', () => {
  test('booking returns a manage link; the nonce never leaks to owner lists', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const r = await book(slug, daysFromToday(3), '10:00');
    assert.equal(r.status, 201);
    assert.match(r.body.manageUrl, new RegExp(`^https://snaptor\\.app/${slug}/manage/[a-f0-9]{24}[A-Za-z0-9_-]{32}$`));
    assert.equal(r.body.manageToken, tokenOf(r.body.manageUrl));
    assert.equal(r.body.manageNonce, undefined);
    const list = await ctx.api.get(`/api/businesses/${slug}/appointments`).set(auth);
    assert.ok(!JSON.stringify(list.body).includes('manageNonce'));
    const g = await ctx.api.get(`/api/manage/${r.body.manageToken}`);
    assert.equal(g.status, 200);
    assert.equal(g.body.appointment.startTime, '10:00');
    assert.equal(g.body.business.slug, slug);
    assert.equal(g.body.policy.canCancel, true);
    assert.equal(g.body.policy.canReschedule, true);
    assert.ok(!('customerPhone' in g.body.appointment), 'no phone in the public view');
  });

  test('invalid / tampered / foreign tokens → 404', async () => {
    const { slug } = await createBusiness(ctx.api);
    const r = await book(slug, daysFromToday(3), '11:00');
    const tok = r.body.manageToken;
    const flipped = tok.slice(0, -1) + (tok.at(-1) === 'A' ? 'B' : 'A');
    for (const t of [flipped, 'garbage', '0'.repeat(24) + 'a'.repeat(32), tok.slice(0, 24) + 'x'.repeat(32)]) {
      const g = await ctx.api.get(`/api/manage/${t}`);
      assert.equal(g.status, 404, t);
      assert.equal(g.body.code, 'invalid_link');
      assert.equal((await ctx.api.post(`/api/manage/${t}/cancel`).send({})).status, 404);
    }
    // rotating the nonce revokes old links
    await ctx.db.collection('appointments').updateOne({ _id: new (require('mongodb').ObjectId)(r.body.id) }, { $set: { manageNonce: 'rotated' } });
    assert.equal((await ctx.api.get(`/api/manage/${tok}`)).status, 404);
  });

  test('customer cancel: status, owner sees it, second cancel refused', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const r = await book(slug, daysFromToday(4), '09:00');
    const c = await ctx.api.post(`/api/manage/${r.body.manageToken}/cancel`).send({ reason: 'sick' });
    assert.equal(c.status, 200);
    assert.equal(c.body.appointment.status, 'cancelled');
    assert.equal(c.body.appointment.cancelledBy, 'customer');
    assert.equal(c.body.policy.canCancel, false);
    const list = await ctx.api.get(`/api/businesses/${slug}/appointments`).set(auth);
    const a = list.body.find(x => x.id === r.body.id);
    assert.equal(a.status, 'cancelled');
    assert.equal(a.cancellationReason, 'sick');
    const again = await ctx.api.post(`/api/manage/${r.body.manageToken}/cancel`).send({});
    assert.equal(again.status, 409);
    // the slot is free again
    assert.equal((await book(slug, daysFromToday(4), '09:00')).status, 201);
  });

  test('cancellation cut-off and allowCustomerCancel are enforced', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const p = await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ bookingPolicy: { cancelCutoffHours: 48 } });
    assert.equal(p.status, 200);
    const r = await book(slug, daysFromToday(1), '19:00');
    const g = await ctx.api.get(`/api/manage/${r.body.manageToken}`);
    assert.equal(g.body.policy.canCancel, false);
    assert.equal(g.body.policy.reason, 'cutoff');
    const c = await ctx.api.post(`/api/manage/${r.body.manageToken}/cancel`).send({});
    assert.equal(c.status, 409);
    assert.equal(c.body.code, 'cannot_cancel_cutoff');

    await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ bookingPolicy: { cancelCutoffHours: 0, allowCustomerCancel: false } });
    const g2 = await ctx.api.get(`/api/manage/${r.body.manageToken}`);
    assert.equal(g2.body.policy.canCancel, false);
    assert.equal(g2.body.policy.canReschedule, true);
    assert.equal((await ctx.api.post(`/api/manage/${r.body.manageToken}/cancel`).send({})).status, 409);
    const bad = await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ bookingPolicy: { cancelCutoffHours: 500 } });
    assert.equal(bad.status, 400);
  });

  test('reschedule request: conflict / closed / past rejected; owner accept moves it; decline restores status', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const d2 = daysFromToday(2), d3 = daysFromToday(3);
    const r = await book(slug, d2, '10:00');
    await book(slug, d3, '11:00');
    const tok = r.body.manageToken;
    const conflict = await ctx.api.post(`/api/manage/${tok}/reschedule`).send({ date: d3, startTime: '11:00' });
    assert.equal(conflict.status, 409);
    const past = await ctx.api.post(`/api/manage/${tok}/reschedule`).send({ date: daysFromToday(-1), startTime: '11:00' });
    assert.equal(past.status, 400);
    const late = await ctx.api.post(`/api/manage/${tok}/reschedule`).send({ date: d3, startTime: '21:00' });
    assert.equal(late.status, 400);
    const same = await ctx.api.post(`/api/manage/${tok}/reschedule`).send({ date: d2, startTime: '10:00' });
    assert.equal(same.status, 400);

    // own slot: moving by 15 minutes overlaps only itself → allowed
    const ok = await ctx.api.post(`/api/manage/${tok}/reschedule`).send({ date: d2, startTime: '10:15', reason: 'later please' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.appointment.status, 'reschedule_requested');
    assert.equal(ok.body.appointment.rescheduleRequest.requestedTime, '10:15');

    // owner sees the request and declines → back to the previous status
    let list = (await ctx.api.get(`/api/businesses/${slug}/appointments`).set(auth)).body;
    let a = list.find(x => x.id === r.body.id);
    assert.equal(a.status, 'reschedule_requested');
    const prev = a.rescheduleRequest.previousStatus;
    const dec = await ctx.api.put(`/api/businesses/${slug}/appointments/${a.id}/reschedule/${a.rescheduleRequest._id}`).set(auth).send({ action: 'decline' });
    assert.equal(dec.status, 200);
    assert.equal(dec.body.status, prev);
    assert.equal(dec.body.date, d2);

    // new request → accept
    const ok2 = await ctx.api.post(`/api/manage/${tok}/reschedule`).send({ date: d3, startTime: '13:00' });
    assert.equal(ok2.status, 200);
    list = (await ctx.api.get(`/api/businesses/${slug}/appointments`).set(auth)).body;
    a = list.find(x => x.id === r.body.id);
    const acc = await ctx.api.put(`/api/businesses/${slug}/appointments/${a.id}/reschedule/${a.rescheduleRequest._id}`).set(auth).send({ action: 'accept' });
    assert.equal(acc.status, 200);
    assert.equal(acc.body.date, d3);
    assert.equal(acc.body.startTime, '13:00');
    assert.equal(acc.body.status, 'confirmed');
    // the manage link keeps working after the move
    const g = await ctx.api.get(`/api/manage/${tok}`);
    assert.equal(g.body.appointment.date, d3);
  });

  test('manage availability ignores the customer\'s own appointment', async () => {
    const { slug } = await createBusiness(ctx.api);
    const d = daysFromToday(5);
    const r = await book(slug, d, '10:00');
    const svc = await svcOf(slug);
    const pub = await ctx.api.get(`/api/businesses/${slug}/availability`).query({ date: d, serviceId: svc.id });
    assert.equal(pub.body.slots.find(s => s.start === '10:00').available, false);
    const mine = await ctx.api.get(`/api/manage/${r.body.manageToken}/availability`).query({ date: d });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.slots.find(s => s.start === '10:00').available, true);
  });

  test('reminders include the manage link (legacy appointments get one lazily)', async () => {
    const { slug, business } = await createBusiness(ctx.api);
    const date = daysFromToday(2);
    const svc = await svcOf(slug);
    const ins = await ctx.db.collection('appointments').insertOne({
      businessId: new (require('mongodb').ObjectId)(business._id), serviceId: svc.id, serviceName: svc.name,
      customerName: 'QA Legacy', customerPhone: '0500000991', date, startTime: '10:00', endTime: '10:30', duration: 30, status: 'confirmed',
    });
    const reminders = require('../lib/reminders');
    const nowMs = T.zonedTimeToUtcMs(date, '10:00', TZ) - 1439 * 60000;
    const due = await reminders.findDue(ctx.db, nowMs);
    const d = due.find(x => String(x.appt._id) === String(ins.insertedId) && x.key === '1day');
    assert.ok(d, 'reminder due');
    assert.match(d.message, new RegExp(`https://snaptor\\.app/${slug}/manage/`));
    assert.ok(!d.message.includes('השב 1'));
    const tok = d.message.split('/manage/')[1].trim();
    assert.equal((await ctx.api.get(`/api/manage/${tok}`)).status, 200);
    // template without a link placeholder and no link → no dangling text
    assert.equal(reminders.renderTemplate('Hi {customer_name} {manage_link}', { customerName: 'A' }, {}), '');
    assert.equal(reminders.renderTemplate('Hi {customer_name}', { customerName: 'A' }, {}, 'https://x/y'), 'Hi A\nhttps://x/y');
  });
});

describe('undo (H-14 / M-16)', () => {
  test('restoring a cancelled appointment works, unless the slot was re-booked', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const d = daysFromToday(6);
    const r = await book(slug, d, '10:00');
    const id = r.body.id;
    assert.equal((await ctx.api.delete(`/api/businesses/${slug}/appointments/${id}`).set(auth).send({})).status, 200);
    const undo = await ctx.api.put(`/api/businesses/${slug}/appointments/${id}`).set(auth).send({ status: 'pending' });
    assert.equal(undo.status, 200);
    assert.equal(undo.body.status, 'pending');
    await ctx.api.delete(`/api/businesses/${slug}/appointments/${id}`).set(auth).send({});
    assert.equal((await book(slug, d, '10:00')).status, 201);
    const clash = await ctx.api.put(`/api/businesses/${slug}/appointments/${id}`).set(auth).send({ status: 'pending' });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'conflict');
  });
});

describe('working hours (H-9)', () => {
  test('server validation: bad times / breaks rejected; partial updates keep other days', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const put = (wh) => ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ workingHours: wh });
    let r = await put({ sunday: { enabled: true, start: '18:00', end: '09:00' } });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_hours');
    r = await put({ sunday: { enabled: true, start: '9:00', end: '25:00' } });
    assert.equal(r.status, 400);
    r = await put({ sunday: { enabled: true, start: '09:00', end: '17:00', breaks: [{ start: '08:00', end: '10:00' }] } });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_breaks');
    r = await put({ sunday: { enabled: true, start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }, { start: '12:30', end: '14:00' }] } });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_breaks');
    r = await put({ funday: { enabled: true } });
    assert.equal(r.status, 200, 'unknown keys are ignored (backward compatible)');
    assert.equal(r.body.workingHours.funday, undefined);
    r = await put({ sunday: { enabled: true, start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }, friday: { enabled: false } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const b = (await ctx.api.get(`/api/businesses/${slug}`)).body;
    assert.deepEqual(b.workingHours.sunday.breaks, [{ start: '12:00', end: '13:00' }]);
    assert.equal(b.workingHours.friday.enabled, false);
    assert.equal(b.workingHours.monday.start, '08:00', 'untouched day kept');
  });

  test('breaks are excluded from availability and customer booking', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const date = nextWeekday('sunday');
    await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ workingHours: { sunday: { enabled: true, start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] } } });
    const svc = await svcOf(slug);
    const av = await ctx.api.get(`/api/businesses/${slug}/availability`).query({ date, serviceId: svc.id });
    const starts = av.body.slots.map(s => s.start);
    assert.ok(starts.includes('11:30') && starts.includes('13:00'));
    assert.ok(!starts.includes('12:00') && !starts.includes('12:30'));
    assert.equal(starts[0], '09:00');
    const r = await book(slug, date, '12:00');
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'outside_hours');
    assert.equal((await book(slug, date, '13:00')).status, 201);
  });

  test('registration validates hours too', async () => {
    await assert.rejects(createBusiness(ctx.api, { workingHours: { ...ALL_OPEN, sunday: { enabled: true, start: '20:00', end: '08:00' } } }), /400/);
  });

  test('staff hours/services survive a rename (M-17)', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const wh = { sunday: { enabled: true, start: '10:00', end: '14:00' } };
    const s1 = await ctx.api.put(`/api/businesses/${slug}/staff`).set(auth).send({ staff: [{ name: 'QA Test Dana', workingHours: wh, services: ['x'] }] });
    assert.equal(s1.status, 200);
    const id = (await ctx.api.get(`/api/businesses/${slug}`)).body.staff[0].id;
    const s2 = await ctx.api.put(`/api/businesses/${slug}/staff`).set(auth).send({ staff: [{ _id: id, name: 'QA Test Dana R' }] });
    assert.equal(s2.status, 200);
    const st = (await ctx.api.get(`/api/businesses/${slug}`)).body.staff[0];
    assert.equal(st.name, 'QA Test Dana R');
    const raw = await ctx.db.collection('businesses').findOne({ slug });
    assert.equal(raw.staff[0].workingHours.sunday.start, '10:00');
    assert.deepEqual(raw.staff[0].services, ['x']);
    await ctx.api.put(`/api/businesses/${slug}/staff`).set(auth).send({ staff: [{ _id: id, name: 'QA Test Dana R', workingDays: [0, 2, 4] }] });
    const raw2 = await ctx.db.collection('businesses').findOne({ slug });
    assert.deepEqual(raw2.staff[0].workingDays, [0, 2, 4], 'numeric working days (staff screen format) are kept');
  });
});

describe('phone change (H-12)', () => {
  test('format, unchanged, uniqueness; OTP off → saved and the new phone logs in', async () => {
    const phone = fakePhone();
    const { slug, auth } = await createBusiness(ctx.api, { phone });
    const other = await createBusiness(ctx.api);
    const post = (body) => ctx.api.post(`/api/businesses/${slug}/phone`).set(auth).send(body);
    assert.equal((await post({ phone: '123' })).body.code, 'invalid_phone');
    assert.equal((await post({ phone: '021234567' })).body.code, 'invalid_phone', 'landline is not a login phone');
    assert.equal((await post({ phone })).body.code, 'phone_unchanged');
    const shared = await post({ phone: other.business.phone });
    assert.equal(shared.status, 409); assert.equal(shared.body.code, 'phone_shared', 'shared number needs acknowledgement (phase 3)');
    const newPhone = fakePhone();
    const ok = await post({ phone: newPhone.replace(/^(\d{3})/, '$1-') });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.otpRequired, false);
    assert.equal(ok.body.business.phone, newPhone);
    const login = await ctx.api.post('/api/auth/login').send({ phone: newPhone, slug });
    assert.equal(login.status, 200);
    // The generic update no longer changes the phone (phase 3); echoing the current one is fine
    const bad = await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ phone: 'abc' });
    assert.equal(bad.status, 400); assert.equal(bad.body.code, 'phone_change_route');
    const echo = await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ phone: newPhone, name: 'QA Test Echo' });
    assert.equal(echo.status, 200);
  });

  test('OTP on: code sent to the new phone, wrong code refused, right code saves; PUT refuses', async () => {
    const sender = createSender({ OTP_PROVIDER: 'console', NODE_ENV: 'test' });
    ctx.srv.setOtpSender(sender);
    process.env.AUTH_OTP_REQUIRED = 'true';
    const { slug, auth } = await createBusiness(ctx.api);
    const newPhone = fakePhone();
    const put = await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ phone: newPhone });
    assert.equal(put.status, 400); assert.equal(put.body.code, 'phone_change_route');
    const s = await ctx.api.post(`/api/businesses/${slug}/phone`).set(auth).send({ phone: newPhone });
    assert.equal(s.status, 200); assert.equal(s.body.otpRequired, true);
    const sent = sender.sent.at(-1);
    assert.equal(sent.phone || sent.to, newPhone);
    const wrong = await ctx.api.post(`/api/businesses/${slug}/phone`).set(auth).send({ phone: newPhone, code: sent.code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400); assert.equal(wrong.body.code, 'otp_invalid');
    const right = await ctx.api.post(`/api/businesses/${slug}/phone`).set(auth).send({ phone: newPhone, code: sent.code });
    assert.equal(right.status, 200); assert.equal(right.body.business.phone, newPhone);
    // the code is bound to the business + phone: a login code for that phone can't be reused here
    assert.equal((await ctx.db.collection('otp_codes').countDocuments({ _id: new RegExp('^phonechange:') })), 0);
  });
});

describe('slugs', () => {
  test('reserved and invalid slugs are refused at registration and in check-username', async () => {
    for (const slug of ['admin', 'privacy', 'support', 'api', 'login', 'register', 'settings', 'Manage']) {
      const r = await ctx.api.post('/api/businesses').send({ name: 'QA Test x', slug, type: 'barber', phone: fakePhone(), workingHours: ALL_OPEN, services: [] });
      assert.equal(r.status, 400, slug); assert.equal(r.body.code, 'slug_reserved', slug);
      const c = await ctx.api.get(`/api/check-username/${slug}`);
      assert.equal(c.body.available, false); assert.equal(c.body.reason, 'reserved');
    }
    for (const slug of ['a', 'bad slug', 'x--y', '-abc', 'שלום']) {
      const r = await ctx.api.post('/api/businesses').send({ name: 'QA Test x', slug, type: 'barber', phone: fakePhone(), workingHours: ALL_OPEN, services: [] });
      assert.equal(r.status, 400, slug); assert.equal(r.body.code, 'slug_invalid', slug);
    }
    const { slug } = await createBusiness(ctx.api);
    const dup = await ctx.api.post('/api/businesses').send({ name: 'QA Test x', slug, type: 'barber', phone: fakePhone(), workingHours: ALL_OPEN, services: [] });
    assert.equal(dup.status, 409); assert.equal(dup.body.code, 'slug_taken');
    assert.equal((await ctx.api.get(`/api/check-username/${slug}`)).body.reason, 'taken');
    assert.equal((await ctx.api.get('/api/check-username/qa-free-name-1')).body.available, true);
  });
});

describe('security headers / CORS / unknown API routes', () => {
  test('SPA pages get a strict CSP; legacy admin page a looser one; API none', async () => {
    const r = await ctx.api.get('/');
    const csp = r.headers['content-security-policy'];
    assert.ok(csp, 'CSP present');
    assert.match(csp, /script-src 'self';/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /object-src 'none'/);
    const admin = await ctx.api.get('/admin.html');
    assert.match(admin.headers['content-security-policy'] || '', /script-src 'self' 'unsafe-inline'/);
    const apiRes = await ctx.api.get('/api/health');
    assert.equal(apiRes.headers['content-security-policy'], undefined);
  });

  test('CSP report endpoint accepts reports', async () => {
    const r = await ctx.api.post('/api/csp-report').set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ 'csp-report': { 'document-uri': 'https://snaptor.app/', 'violated-directive': 'script-src', 'blocked-uri': 'inline' } }));
    assert.equal(r.status, 204);
  });

  test('CORS: own origins allowed, foreign origins get no CORS headers', async () => {
    const ok = await ctx.api.get('/api/health').set('Origin', 'https://snaptor.app');
    assert.equal(ok.headers['access-control-allow-origin'], 'https://snaptor.app');
    const evil = await ctx.api.get('/api/health').set('Origin', 'https://evil.example');
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
    const pre = await ctx.api.options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
  });

  test('unknown /api routes → 404 JSON', async () => {
    for (const [m, u] of [['get', '/api/nope'], ['post', '/api/businesses/x/nope/deeper'], ['delete', '/api/manage']]) {
      const r = await ctx.api[m](u);
      assert.equal(r.status, 404, u);
      assert.match(r.headers['content-type'], /json/);
    }
  });
});
