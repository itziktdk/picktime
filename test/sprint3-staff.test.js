'use strict';
// Sprint 3: staff login (OTP) with staff permissions; multiple memberships per phone + switcher.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, daysFromToday } = require('./helpers');
const { createSender } = require('../lib/otp-sender');

let ctx, sender;
before(async () => {
  ctx = await setup();
  sender = createSender({ OTP_PROVIDER: 'console', NODE_ENV: 'test' });
  ctx.srv.setOtpSender(sender);
  process.env.AUTH_OTP_REQUIRED = 'true';
});
after(async () => { delete process.env.AUTH_OTP_REQUIRED; await ctx.teardown(); });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
async function otpLogin(phone, extra = {}) {
  await ctx.db.collection('rate_limits').deleteMany({});
  assert.equal((await ctx.api.post('/api/auth/login').send({ phone })).status, 200);
  return ctx.api.post('/api/auth/verify-otp').send({ phone, code: sender.sent.at(-1).code, ...extra });
}

describe('S3 staff login + memberships', () => {
  test('owner enables login for a staff member; staff logs in with OTP, limited permissions; revocation', async () => {
    const A = await createBusiness(ctx.api, { phone: '0500000901' });
    // validation: login needs a valid phone; duplicates rejected
    let r = await ctx.api.put(`/api/businesses/${A.slug}/staff`).set(A.auth).send({ staff: [{ name: 'QA Dana', canLogin: true, phone: '12' }] });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'staff_login_phone');
    r = await ctx.api.put(`/api/businesses/${A.slug}/staff`).set(A.auth).send({ staff: [{ name: 'QA Dana', canLogin: true, phone: '050-000-0902' }, { name: 'QA Avi', canLogin: true, phone: '0500000902' }] });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'staff_login_dup');
    r = await ctx.api.put(`/api/businesses/${A.slug}/staff`).set(A.auth).send({ staff: [{ name: 'QA Dana', canLogin: true, phone: '050-000-0902' }, { name: 'QA Avi', phone: '0500000903' }] });
    assert.equal(r.status, 200);
    const dana = r.body.staff.find(s => s.name === 'QA Dana');
    // Avi has a phone but no login access → unknown
    assert.equal((await otpLogin('0500000903')).body.exists, false);
    const v = await otpLogin('0500000902');
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.business.slug, A.slug);
    assert.deepEqual(v.body.business.me, { role: 'staff', staffId: dana.id, name: 'QA Dana' });
    const st = bearer(v.body.token);
    assert.equal((await ctx.api.get('/api/auth/me').set(st)).body.me.role, 'staff');
    // allowed
    const svc = String(A.business.services[0]._id);
    const appt = await ctx.api.post(`/api/businesses/${A.slug}/appointments`).set(st).send({ customerName: 'QA C', customerPhone: '0500000904', serviceId: svc, date: daysFromToday(2), startTime: '10:00' });
    assert.equal(appt.status, 201, 'staff can book without a booking token');
    assert.equal((await ctx.api.get(`/api/businesses/${A.slug}/appointments`).set(st)).status, 200);
    assert.equal((await ctx.api.put(`/api/businesses/${A.slug}/appointments/${appt.body.id}`).set(st).send({ status: 'confirmed' })).status, 200);
    assert.equal((await ctx.api.get(`/api/businesses/${A.slug}/customers`).set(st)).status, 200);
    assert.equal((await ctx.api.post(`/api/businesses/${A.slug}/tasks`).set(st).send({ text: 'QA' })).status, 201);
    const stats = (await ctx.api.get(`/api/businesses/${A.slug}/stats`).set(st)).body;
    assert.equal(stats.weekRevenue, null); assert.equal(stats.todayRevenue, null);
    assert.notEqual((await ctx.api.get(`/api/businesses/${A.slug}/stats`).set(A.auth)).body.weekRevenue, null);
    // owner-only
    for (const [m, url, body] of [['put', `/api/businesses/${A.slug}`, { name: 'x' }], ['put', `/api/businesses/${A.slug}/staff`, { staff: [] }],
      ['post', `/api/businesses/${A.slug}/services`, { name: 'x', duration: 10 }], ['post', `/api/businesses/${A.slug}/customers/import`, { rows: [] }],
      ['post', `/api/businesses/${A.slug}/calendar-feeds`, {}], ['get', `/api/businesses/${A.slug}/stats/extended`, null], ['post', `/api/businesses/${A.slug}/announcements`, { message: 'x' }]]) {
      const rr = await ctx.api[m](url).set(st).send(body || undefined);
      assert.equal(rr.status, 403, `${m} ${url}`); assert.equal(rr.body.code, 'owner_only');
    }
    assert.equal((await ctx.api.delete('/api/account').set(st).send({ confirmSlug: A.slug })).status, 403);
    assert.ok(await ctx.db.collection('businesses').findOne({ slug: A.slug }));
    // refresh keeps the staff role
    const ref = await ctx.api.post('/api/auth/refresh').set(st);
    assert.equal((await ctx.api.get('/api/auth/me').set(bearer(ref.body.token))).body.me.role, 'staff');
    // revoke: owner turns login off → token stops working
    r = await ctx.api.put(`/api/businesses/${A.slug}/staff`).set(A.auth).send({ staff: [{ _id: dana.id, name: 'QA Dana', canLogin: false, phone: '0500000902' }] });
    assert.equal(r.status, 200);
    const gone = await ctx.api.get(`/api/businesses/${A.slug}/appointments`).set(st);
    assert.equal(gone.status, 401); assert.equal(gone.body.code, 'staff_revoked');
    // a forged staff token for another business does nothing
    const B = await createBusiness(ctx.api, { phone: '0500000905' });
    assert.equal((await ctx.api.get(`/api/businesses/${B.slug}/appointments`).set(st)).status, 401);
  });

  test('one phone: owner of A, staff of B, customer of C → picker, switcher, customer booking unaffected', async () => {
    const phone = '0500000911';
    const A = await createBusiness(ctx.api, { phone });
    const B = await createBusiness(ctx.api, { phone: '0500000912' });
    const C = await createBusiness(ctx.api, { phone: '0500000913' });
    await ctx.api.put(`/api/businesses/${B.slug}/staff`).set(B.auth).send({ staff: [{ name: 'QA Multi', canLogin: true, phone }] });
    // the same person books at C as a customer (public flow, unchanged) and at B too
    for (const biz of [C, B]) {
      const tok = (await ctx.api.get(`/api/businesses/${biz.slug}/booking-token`)).body.token;
      const r = await ctx.api.post(`/api/businesses/${biz.slug}/appointments`).send({ bookingToken: tok, customerName: 'QA Multi', customerPhone: phone, serviceId: String(biz.business.services[0]._id), date: daysFromToday(3), startTime: '11:00' });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    const v = await otpLogin(phone);
    assert.equal(v.body.exists, true); assert.ok(v.body.loginTicket); assert.equal(v.body.token, undefined);
    const items = v.body.businesses.map(b => `${b.slug}:${b.role}`).sort();
    assert.deepEqual(items, [`${A.slug}:owner`, `${B.slug}:staff`].sort());
    const t1 = await ctx.api.post('/api/auth/login').send({ phone, slug: B.slug, role: 'staff', loginTicket: v.body.loginTicket });
    assert.equal(t1.status, 200); assert.equal(t1.body.business.me.role, 'staff');
    const st = bearer(t1.body.token);
    const mem = (await ctx.api.get('/api/auth/memberships').set(st)).body;
    assert.equal(mem.current.slug, B.slug); assert.equal(mem.current.role, 'staff');
    assert.equal(mem.memberships.length, 2);
    assert.deepEqual(mem.customerOf.map(c => c.slug), [C.slug]); // B is a membership, not listed again
    const sw = await ctx.api.post('/api/auth/switch').set(st).send({ slug: A.slug, role: 'owner' });
    assert.equal(sw.status, 200); assert.equal(sw.body.business.me.role, 'owner'); assert.equal(sw.body.business.slug, A.slug);
    assert.equal((await ctx.api.put(`/api/businesses/${A.slug}`).set(bearer(sw.body.token)).send({ name: 'QA Renamed' })).status, 200);
    assert.equal((await ctx.api.post('/api/auth/switch').set(st).send({ slug: C.slug })).status, 403);
    // owner token of A can switch to B as staff
    const back = await ctx.api.post('/api/auth/switch').set(A.auth).send({ slug: B.slug, role: 'staff' });
    assert.equal(back.status, 200); assert.equal(back.body.business.me.role, 'staff');
  });
});
