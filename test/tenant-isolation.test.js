'use strict';
// C-2: every owner route must be scoped to the authenticated business.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { setup, createBusiness, daysFromToday } = require('./helpers');

let ctx, A, B, ids;

before(async () => {
  ctx = await setup();
  A = await createBusiness(ctx.api, { slug: 'qa-test-victim' });
  B = await createBusiness(ctx.api, { slug: 'qa-test-attacker' });
  const svcA = (await ctx.api.get('/api/auth/me').set(A.auth)).body.services[0];
  const appt = (await ctx.api.post(`/api/businesses/${A.slug}/appointments`).set(A.auth).send({
    serviceId: svcA.id, customerName: 'QA Test Victim Cust', customerPhone: '0500000981', date: daysFromToday(2), startTime: '10:00', notes: 'original',
  })).body;
  const rr = (await ctx.api.post(`/api/businesses/${A.slug}/appointments/${appt.id}/reschedule`).set(A.auth).send({ requestedDate: daysFromToday(3), requestedTime: '11:00' })).body;
  const cust = (await ctx.api.get(`/api/businesses/${A.slug}/customers`).set(A.auth)).body[0];
  const task = (await ctx.api.post(`/api/businesses/${A.slug}/tasks`).set(A.auth).send({ text: 'QA Test victim task' })).body;
  const ann = (await ctx.api.post(`/api/businesses/${A.slug}/announcements`).set(A.auth).send({ message: 'QA Test victim announcement' })).body;
  ids = { appt: appt.id, rr: String(rr.rescheduleRequest._id), cust: cust.id, task: task.id, ann: ann.id, svc: svcA.id };
});
after(async () => { await ctx.teardown(); });

async function snapshot() {
  const db = ctx.db;
  return {
    appt: await db.collection('appointments').findOne({ _id: new ObjectId(ids.appt) }),
    cust: await db.collection('customers').findOne({ _id: new ObjectId(ids.cust) }),
    task: await db.collection('tasks').findOne({ _id: new ObjectId(ids.task) }),
    ann: await db.collection('announcements').findOne({ _id: new ObjectId(ids.ann) }),
    biz: await db.collection('businesses').findOne({ slug: A.slug }),
  };
}

// Attacker uses THEIR OWN slug + the victim's object id → must be 404 and change nothing.
const objectRoutes = () => [
  ['put', `/api/businesses/${B.slug}/appointments/${ids.appt}`, { notes: 'pwned', status: 'cancelled' }],
  ['delete', `/api/businesses/${B.slug}/appointments/${ids.appt}`, {}],
  ['post', `/api/businesses/${B.slug}/appointments/${ids.appt}/reschedule`, { requestedDate: daysFromToday(4), requestedTime: '12:00' }],
  ['put', `/api/businesses/${B.slug}/appointments/${ids.appt}/reschedule/${ids.rr}`, { action: 'accept' }],
  ['put', `/api/businesses/${B.slug}/appointments/${ids.appt}/reschedule/${ids.rr}`, { action: 'decline' }],
  ['get', `/api/businesses/${B.slug}/customers/${ids.cust}`, null],
  ['put', `/api/businesses/${B.slug}/customers/${ids.cust}`, { name: 'pwned', phone: '0500000000' }],
  ['put', `/api/businesses/${B.slug}/tasks/${ids.task}`, { text: 'pwned' }],
  ['delete', `/api/businesses/${B.slug}/tasks/${ids.task}`, {}],
  ['delete', `/api/businesses/${B.slug}/announcements/${ids.ann}`, {}],
  ['put', `/api/businesses/${B.slug}/services/${ids.svc}`, { price: 1 }],
  ['delete', `/api/businesses/${B.slug}/services/${ids.svc}`, {}],
];

// Attacker uses the VICTIM's slug → 403.
const slugRoutes = () => [
  ['put', `/api/businesses/${A.slug}`, { name: 'pwned' }],
  ['post', `/api/businesses/${A.slug}/phone`, { phone: '0500000977' }],
  ['get', `/api/businesses/${A.slug}/appointments`, null],
  ['put', `/api/businesses/${A.slug}/appointments/${ids.appt}`, { notes: 'pwned' }],
  ['delete', `/api/businesses/${A.slug}/appointments/${ids.appt}`, {}],
  ['post', `/api/businesses/${A.slug}/appointments/${ids.appt}/reschedule`, { requestedDate: daysFromToday(4), requestedTime: '12:00' }],
  ['put', `/api/businesses/${A.slug}/appointments/${ids.appt}/reschedule/${ids.rr}`, { action: 'accept' }],
  ['post', `/api/businesses/${A.slug}/announcements`, { message: 'pwned' }],
  ['delete', `/api/businesses/${A.slug}/announcements/${ids.ann}`, {}],
  ['get', `/api/businesses/${A.slug}/customers`, null],
  ['get', `/api/businesses/${A.slug}/customers/groups`, null],
  ['post', `/api/businesses/${A.slug}/customers`, { name: 'x', phone: '0500000000' }],
  ['get', `/api/businesses/${A.slug}/customers/${ids.cust}`, null],
  ['put', `/api/businesses/${A.slug}/customers/${ids.cust}`, { name: 'pwned' }],
  ['get', `/api/businesses/${A.slug}/tasks`, null],
  ['post', `/api/businesses/${A.slug}/tasks`, { text: 'pwned' }],
  ['put', `/api/businesses/${A.slug}/tasks/${ids.task}`, { text: 'pwned' }],
  ['delete', `/api/businesses/${A.slug}/tasks/${ids.task}`, {}],
  ['post', `/api/businesses/${A.slug}/services`, { name: 'pwned', duration: 10 }],
  ['put', `/api/businesses/${A.slug}/services/${ids.svc}`, { price: 1 }],
  ['delete', `/api/businesses/${A.slug}/services/${ids.svc}`, {}],
  ['put', `/api/businesses/${A.slug}/staff`, { staff: [] }],
  ['get', `/api/businesses/${A.slug}/staff/all`, null],
  ['get', `/api/businesses/${A.slug}/stats`, null],
  ['get', `/api/businesses/${A.slug}/stats/extended`, null],
  ['get', `/api/businesses/${A.slug}/reminders`, null],
];

function send(method, url, body, headers) {
  let r = ctx.api[method](url).set(headers);
  if (body) r = r.send(body);
  return r;
}

describe('cross-tenant isolation (C-2)', () => {
  test('own slug + victim object id → 404 for every child-object route, victim data unchanged', async () => {
    const beforeSnap = await snapshot();
    for (const [m, url, body] of objectRoutes()) {
      const r = await send(m, url, body, B.auth);
      assert.equal(r.status, 404, `${m.toUpperCase()} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    }
    const afterSnap = await snapshot();
    assert.deepEqual(afterSnap, beforeSnap, 'victim data must not change');
  });

  test('victim slug → 403 for every owner route, victim data unchanged', async () => {
    const beforeSnap = await snapshot();
    for (const [m, url, body] of slugRoutes()) {
      const r = await send(m, url, body, B.auth);
      assert.equal(r.status, 403, `${m.toUpperCase()} ${url} → ${r.status}`);
    }
    assert.deepEqual(await snapshot(), beforeSnap);
  });

  test('no token → 401 for every owner route', async () => {
    for (const [m, url, body] of [...slugRoutes(), ...objectRoutes()]) {
      const r = await send(m, url, body, {});
      assert.equal(r.status, 401, `${m.toUpperCase()} ${url} → ${r.status}`);
    }
  });

  test('the victim can still do all of it on their own data (positive control)', async () => {
    const r1 = await ctx.api.get(`/api/businesses/${A.slug}/customers/${ids.cust}`).set(A.auth);
    assert.equal(r1.status, 200);
    assert.equal(r1.body.name, 'QA Test Victim Cust');
    assert.equal((await ctx.api.put(`/api/businesses/${A.slug}/tasks/${ids.task}`).set(A.auth).send({ completed: true })).status, 200);
    assert.equal((await ctx.api.put(`/api/businesses/${A.slug}/appointments/${ids.appt}`).set(A.auth).send({ notes: 'owner edit' })).status, 200);
  });

  test('lists only contain the caller\'s own records', async () => {
    const appts = await ctx.api.get(`/api/businesses/${B.slug}/appointments`).set(B.auth);
    const custs = await ctx.api.get(`/api/businesses/${B.slug}/customers`).set(B.auth);
    const tasks = await ctx.api.get(`/api/businesses/${B.slug}/tasks`).set(B.auth);
    assert.deepEqual([appts.body.length, custs.body.length, tasks.body.length], [0, 0, 0]);
  });

  test('malformed ids → 400 (not 500) on every :id route', async () => {
    const bad = 'not-an-id';
    const urls = [
      ['put', `/api/businesses/${B.slug}/appointments/${bad}`], ['delete', `/api/businesses/${B.slug}/appointments/${bad}`],
      ['post', `/api/businesses/${B.slug}/appointments/${bad}/reschedule`], ['put', `/api/businesses/${B.slug}/appointments/${ids.appt}/reschedule/${bad}`],
      ['get', `/api/businesses/${B.slug}/customers/${bad}`], ['put', `/api/businesses/${B.slug}/customers/${bad}`],
      ['put', `/api/businesses/${B.slug}/tasks/${bad}`], ['delete', `/api/businesses/${B.slug}/tasks/${bad}`],
      ['delete', `/api/businesses/${B.slug}/announcements/${bad}`],
      ['put', `/api/businesses/${B.slug}/services/${bad}`], ['delete', `/api/businesses/${B.slug}/services/${bad}`],
      ['put', `/api/admin/businesses/${bad}`], ['delete', `/api/admin/businesses/${bad}`], ['patch', `/api/admin/businesses/${bad}/toggle`],
    ];
    for (const [m, url] of urls) {
      const r = await send(m, url, {}, B.auth);
      assert.equal(r.status, 400, `${m} ${url} → ${r.status}`);
    }
  });

  test('account deletion only ever deletes the caller', async () => {
    const r = await ctx.api.delete('/api/account').set(B.auth).send({ confirmSlug: A.slug });
    assert.equal(r.status, 400);
    assert.ok(await ctx.db.collection('businesses').findOne({ slug: A.slug }));
  });

  test('route inventory: every /api/businesses/:slug write route is covered by this suite', () => {
    const covered = new Set([...objectRoutes(), ...slugRoutes()].map(([m, url]) => `${m} ${url
      .replace(`/api/businesses/${A.slug}`, '/api/businesses/:slug').replace(`/api/businesses/${B.slug}`, '/api/businesses/:slug')
      .replace(ids.appt, ':id').replace(ids.rr, ':requestId').replace(ids.cust, ':id').replace(ids.task, ':id').replace(ids.ann, ':id').replace(ids.svc, ':id')}`));
    // Intentionally public (no auth by design): business profile, services, staff, availability, announcements list,
    // booking token, public booking.
    const publicRoutes = new Set([
      'get /api/businesses/:slug', 'get /api/businesses/:slug/services', 'get /api/businesses/:slug/staff',
      'get /api/businesses/:slug/availability', 'get /api/businesses/:slug/announcements',
      'get /api/businesses/:slug/booking-token', 'post /api/businesses/:slug/appointments',
    ]);
    const missing = [];
    for (const layer of ctx.srv.app._router.stack) {
      if (!layer.route || !layer.route.path.startsWith('/api/businesses/:slug')) continue;
      for (const m of Object.keys(layer.route.methods)) {
        const key = `${m} ${layer.route.path}`;
        if (!covered.has(key) && !publicRoutes.has(key)) missing.push(key);
      }
    }
    assert.deepEqual(missing, [], 'add new owner routes to the isolation suite');
  });
});
