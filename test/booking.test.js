'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, publicBook, bookingToken, daysFromToday, nextWeekday, today, T, TZ } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

describe('ids are normalized (C-1 / H-1 / C-5 root cause)', () => {
  test('public business returns services and staff with both _id and id', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    await ctx.api.put(`/api/businesses/${slug}/staff`).set(auth).send({ staff: [{ name: 'QA Test Noa' }] });
    const r = await ctx.api.get(`/api/businesses/${slug}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.services.length, 3);
    const ids = new Set();
    for (const s of r.body.services) {
      assert.match(s.id, /^[a-f0-9]{24}$/);
      assert.equal(String(s._id), s.id);
      ids.add(s.id);
    }
    assert.equal(ids.size, 3, 'service ids are unique');
    assert.match(r.body.staff[0].id, /^[a-f0-9]{24}$/);
    assert.equal(r.body.timezone, TZ);
  });

  test('owner /auth/me returns services whose id equals _id (no onboarding "1"/"2" ids)', async () => {
    const { auth } = await createBusiness(ctx.api);
    const me = await ctx.api.get('/api/auth/me').set(auth);
    assert.equal(me.status, 200);
    for (const s of me.body.services) assert.equal(s.id, String(s._id));
  });
});

describe('public booking (C-1)', () => {
  test('creates an appointment with the selected service and it is visible to the owner', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const pub = (await ctx.api.get(`/api/businesses/${slug}`)).body;
    const svc = pub.services[2];
    const date = daysFromToday(2);
    const r = await publicBook(ctx.api, slug, { serviceId: svc.id, date, startTime: '10:00' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.serviceName, 'QA Color');
    assert.equal(r.body.endTime, '11:00');
    assert.equal(r.body.duration, 60);
    assert.equal(r.body.price, 120);
    assert.match(r.body.id, /^[a-f0-9]{24}$/);
    const list = await ctx.api.get(`/api/businesses/${slug}/appointments`).set(auth);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].serviceName, 'QA Color');
  });

  test('missing serviceId → 400 with a message (not silently swallowed)', async () => {
    const { slug } = await createBusiness(ctx.api);
    const r = await publicBook(ctx.api, slug, { date: daysFromToday(2), startTime: '10:00' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /serviceId/);
  });

  test('legacy index/name fallbacks are gone: serviceId "1" or a name is rejected', async () => {
    const { slug } = await createBusiness(ctx.api);
    for (const serviceId of ['1', '0', 'QA Haircut']) {
      const r = await publicBook(ctx.api, slug, { serviceId, date: daysFromToday(2), startTime: '10:00' });
      assert.equal(r.status, 400, serviceId);
      assert.equal(r.body.code, 'service_not_found');
    }
  });

  test('booking token is single use and bound to the slug; non-string token rejected', async () => {
    const a = await createBusiness(ctx.api);
    const b = await createBusiness(ctx.api);
    const svc = (await ctx.api.get(`/api/businesses/${a.slug}`)).body.services[0];
    const tok = await bookingToken(ctx.api, a.slug);
    const body = { bookingToken: tok, serviceId: svc.id, customerName: 'QA Test', customerPhone: '0500000991', date: daysFromToday(3), startTime: '09:00' };
    assert.equal((await ctx.api.post(`/api/businesses/${b.slug}/appointments`).send(body)).status, 403, 'other slug');
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/appointments`).send(body)).status, 201);
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/appointments`).send({ ...body, startTime: '12:00' })).status, 403, 'reused');
    const inj = await ctx.api.post(`/api/businesses/${a.slug}/appointments`).send({ ...body, bookingToken: { $ne: null } });
    assert.equal(inj.status, 403);
    assert.equal((await ctx.api.get('/api/businesses/qa-test-nope-xyz/booking-token')).status, 404);
  });

  test('double booking the same slot → 409', async () => {
    const { slug } = await createBusiness(ctx.api);
    const svc = (await ctx.api.get(`/api/businesses/${slug}`)).body.services[0];
    const date = daysFromToday(2);
    assert.equal((await publicBook(ctx.api, slug, { serviceId: svc.id, date, startTime: '11:00' })).status, 201);
    const r = await publicBook(ctx.api, slug, { serviceId: svc.id, date, startTime: '11:15' });
    assert.equal(r.status, 409);
  });
});

describe('booking integrity (H-6)', () => {
  test('past date, past time today, closed day, out of hours and past midnight are rejected', async () => {
    const hours = Object.fromEntries(T.DAY_NAMES.map(d => [d, { start: '09:00', end: '18:00', enabled: d !== 'saturday' }]));
    const { slug } = await createBusiness(ctx.api, { workingHours: hours });
    const svc = (await ctx.api.get(`/api/businesses/${slug}`)).body.services[0];
    const cases = [
      [{ date: daysFromToday(-1), startTime: '10:00' }, 'past'],
      [{ date: nextWeekday('saturday'), startTime: '11:00' }, 'closed'],
      [{ date: nextWeekday('monday'), startTime: '08:30' }, 'outside_hours'],
      [{ date: nextWeekday('monday'), startTime: '17:45' }, 'outside_hours'],
      [{ date: nextWeekday('monday'), startTime: '23:30' }, 'outside_hours'],
      [{ date: '2026-02-30', startTime: '10:00' }, 'invalid_date'],
      [{ date: nextWeekday('monday'), startTime: '25:00' }, 'invalid_time'],
    ];
    for (const [body, code] of cases) {
      const r = await publicBook(ctx.api, slug, { serviceId: svc.id, ...body });
      assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, code, JSON.stringify(body));
    }
    const ok = await publicBook(ctx.api, slug, { serviceId: svc.id, date: nextWeekday('monday'), startTime: '17:30' });
    assert.equal(ok.status, 201, 'last slot that ends exactly at closing time is OK');
  });

  test('a time earlier today is rejected for customers', async () => {
    const { slug } = await createBusiness(ctx.api);
    const svc = (await ctx.api.get(`/api/businesses/${slug}`)).body.services[0];
    const now = T.nowInTz(TZ);
    if (now.minutes < 1) return; // just after midnight: nothing earlier today
    const r = await publicBook(ctx.api, slug, { serviceId: svc.id, date: today(), startTime: '00:00' });
    assert.equal(r.status, 400);
  });

  test('availability: closed day and past date report no slots (no fake slots)', async () => {
    const hours = Object.fromEntries(T.DAY_NAMES.map(d => [d, { start: '09:00', end: '18:00', enabled: d !== 'monday' }]));
    const { slug } = await createBusiness(ctx.api, { workingHours: hours });
    const closed = await ctx.api.get(`/api/businesses/${slug}/availability`).query({ date: nextWeekday('monday') });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.available, false);
    assert.deepEqual(closed.body.slots, []);
    assert.equal(closed.body.reason, 'closed');
    const past = await ctx.api.get(`/api/businesses/${slug}/availability`).query({ date: daysFromToday(-2) });
    assert.equal(past.body.reason, 'past');
    const bad = await ctx.api.get(`/api/businesses/${slug}/availability`).query({ date: 'nope' });
    assert.equal(bad.status, 400);
  });

  test('availability slot length follows the service and marks booked slots', async () => {
    const { slug } = await createBusiness(ctx.api);
    const svcs = (await ctx.api.get(`/api/businesses/${slug}`)).body.services;
    const date = daysFromToday(4);
    await publicBook(ctx.api, slug, { serviceId: svcs[0].id, date, startTime: '09:00' });
    const r = await ctx.api.get(`/api/businesses/${slug}/availability`).query({ date, serviceId: svcs[2].id });
    assert.equal(r.status, 200);
    assert.equal(r.body.slots[0].start, '08:00');
    assert.equal(r.body.slots[0].end, '09:00');
    assert.equal(r.body.slots.find(s => s.start === '09:00').available, false);
    assert.equal(r.body.slots.find(s => s.start === '10:00').available, true);
  });

  test('negative/zero durations and negative prices are rejected for services', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    assert.equal((await ctx.api.post(`/api/businesses/${slug}/services`).set(auth).send({ name: 'QA Zero', duration: -15, price: 10 })).status, 400);
    assert.equal((await ctx.api.post(`/api/businesses/${slug}/services`).set(auth).send({ name: 'QA Zero', duration: 0 })).status, 400);
    assert.equal((await ctx.api.post(`/api/businesses/${slug}/services`).set(auth).send({ name: 'QA Neg', duration: 30, price: -100 })).status, 400);
    const ok = await ctx.api.post(`/api/businesses/${slug}/services`).set(auth).send({ name: 'QA Later', duration: 20, price: 50 });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.id, String(ok.body._id));
  });
});

describe('staff (H-2)', () => {
  async function staffedBusiness() {
    const b = await createBusiness(ctx.api);
    const svcs = (await ctx.api.get(`/api/businesses/${b.slug}`)).body.services;
    const r = await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: [
      { name: 'QA Test Noa', services: [] },
      { name: 'QA Test Dan', services: [svcs[0].id] },
    ] });
    assert.equal(r.status, 200);
    const staff = (await ctx.api.get(`/api/businesses/${b.slug}/staff`)).body;
    return { ...b, svcs, staff };
  }

  test('specific staff member is stored on the appointment', async () => {
    const b = await staffedBusiness();
    const dan = b.staff.find(s => s.name === 'QA Test Dan');
    const r = await publicBook(ctx.api, b.slug, { serviceId: b.svcs[0].id, staffId: dan.id, date: daysFromToday(2), startTime: '10:00' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.staffId, dan.id);
    assert.equal(r.body.staffName, 'QA Test Dan');
  });

  test('"Any staff" (no staffId) is accepted and auto-assigns a free staff member', async () => {
    const b = await staffedBusiness();
    const date = daysFromToday(2);
    const first = await publicBook(ctx.api, b.slug, { serviceId: b.svcs[0].id, date, startTime: '10:00' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.ok(first.body.staffId);
    const second = await publicBook(ctx.api, b.slug, { serviceId: b.svcs[0].id, date, startTime: '10:00' });
    assert.equal(second.status, 201, 'second staff member takes the same slot');
    assert.notEqual(second.body.staffId, first.body.staffId);
    const third = await publicBook(ctx.api, b.slug, { serviceId: b.svcs[0].id, date, startTime: '10:00' });
    assert.equal(third.status, 409, 'everyone busy');
  });

  test('"Any staff" only picks staff who provide the service', async () => {
    const b = await staffedBusiness();
    const noa = b.staff.find(s => s.name === 'QA Test Noa');
    const r = await publicBook(ctx.api, b.slug, { serviceId: b.svcs[2].id, date: daysFromToday(2), startTime: '12:00' });
    assert.equal(r.status, 201);
    assert.equal(r.body.staffId, noa.id);
  });

  test('staff who does not provide the service, unknown and inactive staff are rejected', async () => {
    const b = await staffedBusiness();
    const dan = b.staff.find(s => s.name === 'QA Test Dan');
    assert.equal((await publicBook(ctx.api, b.slug, { serviceId: b.svcs[2].id, staffId: dan.id, date: daysFromToday(2), startTime: '10:00' })).status, 400);
    assert.equal((await publicBook(ctx.api, b.slug, { serviceId: b.svcs[0].id, staffId: '0123456789abcdef01234567', date: daysFromToday(2), startTime: '10:00' })).status, 400);
  });

  test('availability without staffId reports a slot free while any eligible staff is free', async () => {
    const b = await staffedBusiness();
    const date = daysFromToday(5);
    await publicBook(ctx.api, b.slug, { serviceId: b.svcs[0].id, date, startTime: '10:00' });
    let r = await ctx.api.get(`/api/businesses/${b.slug}/availability`).query({ date, serviceId: b.svcs[0].id });
    assert.equal(r.body.slots.find(s => s.start === '10:00').available, true);
    await publicBook(ctx.api, b.slug, { serviceId: b.svcs[0].id, date, startTime: '10:00' });
    r = await ctx.api.get(`/api/businesses/${b.slug}/availability`).query({ date, serviceId: b.svcs[0].id });
    assert.equal(r.body.slots.find(s => s.start === '10:00').available, false);
    const dan = b.staff.find(s => s.name === 'QA Test Dan');
    r = await ctx.api.get(`/api/businesses/${b.slug}/availability`).query({ date, serviceId: b.svcs[0].id, staffId: dan.id });
    assert.equal(r.body.slots.find(s => s.start === '10:00').available, false);
  });
});

describe('owner new appointment (C-5)', () => {
  test('books exactly the selected service, including services added after onboarding', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const added = (await ctx.api.post(`/api/businesses/${slug}/services`).set(auth).send({ name: 'QA Added Later', duration: 20, price: 40 })).body;
    const me = (await ctx.api.get('/api/auth/me').set(auth)).body;
    const date = daysFromToday(1);
    for (const [i, svc] of [...me.services.slice(0, 3), added].entries()) {
      const r = await ctx.api.post(`/api/businesses/${slug}/appointments`).set(auth).send({
        serviceId: svc.id, customerName: 'QA Test Owner Cust', customerPhone: '0500000992', date, startTime: `${String(9 + i * 2).padStart(2, '0')}:00`,
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.serviceName, svc.name);
      assert.equal(r.body.duration, svc.duration);
      assert.equal(r.body.source, 'owner');
    }
  });

  test('owner may book outside hours but not on a past date; token of another business is not owner', async () => {
    const hours = Object.fromEntries(T.DAY_NAMES.map(d => [d, { start: '09:00', end: '18:00', enabled: true }]));
    const a = await createBusiness(ctx.api, { workingHours: hours });
    const b = await createBusiness(ctx.api);
    const svc = (await ctx.api.get('/api/auth/me').set(a.auth)).body.services[0];
    const base = { serviceId: svc.id, customerName: 'QA Test', customerPhone: '0500000993' };
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/appointments`).set(a.auth).send({ ...base, date: daysFromToday(1), startTime: '19:00' })).status, 201);
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/appointments`).set(a.auth).send({ ...base, date: daysFromToday(-1), startTime: '10:00' })).status, 400);
    // B's token on A's slug is a public booking without a booking token → 403
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/appointments`).set(b.auth).send({ ...base, date: daysFromToday(1), startTime: '12:00' })).status, 403);
  });
});

describe('reschedule accept (H-7) and status validation', () => {
  test('accept recomputes endTime and checks conflicts', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const svc = (await ctx.api.get('/api/auth/me').set(auth)).body.services[2]; // 60 min
    const date = daysFromToday(3);
    const mk = (startTime) => ctx.api.post(`/api/businesses/${slug}/appointments`).set(auth).send({ serviceId: svc.id, customerName: 'QA Test', customerPhone: '0500000994', date, startTime });
    const a1 = (await mk('10:00')).body;
    const a2 = (await mk('13:00')).body;
    let rr = await ctx.api.post(`/api/businesses/${slug}/appointments/${a1.id}/reschedule`).set(auth).send({ requestedDate: date, requestedTime: '11:00' });
    assert.equal(rr.status, 200);
    let acc = await ctx.api.put(`/api/businesses/${slug}/appointments/${a1.id}/reschedule/${rr.body.rescheduleRequest._id}`).set(auth).send({ action: 'accept' });
    assert.equal(acc.status, 200);
    assert.equal(acc.body.startTime, '11:00');
    assert.equal(acc.body.endTime, '12:00');
    rr = await ctx.api.post(`/api/businesses/${slug}/appointments/${a2.id}/reschedule`).set(auth).send({ requestedDate: date, requestedTime: '11:30' });
    acc = await ctx.api.put(`/api/businesses/${slug}/appointments/${a2.id}/reschedule/${rr.body.rescheduleRequest._id}`).set(auth).send({ action: 'accept' });
    assert.equal(acc.status, 409);
  });

  test('arbitrary status string → 400', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const svc = (await ctx.api.get('/api/auth/me').set(auth)).body.services[0];
    const a = (await ctx.api.post(`/api/businesses/${slug}/appointments`).set(auth).send({ serviceId: svc.id, customerName: 'QA', customerPhone: '0500000995', date: daysFromToday(2), startTime: '10:00' })).body;
    assert.equal((await ctx.api.put(`/api/businesses/${slug}/appointments/${a.id}`).set(auth).send({ status: 'totally-bogus' })).status, 400);
    assert.equal((await ctx.api.put(`/api/businesses/${slug}/appointments/${a.id}`).set(auth).send({ status: 'confirmed' })).status, 200);
  });
});

describe('robustness', () => {
  test('unknown /api route → 404 JSON quickly; malformed ObjectId → 400', async () => {
    const r = await ctx.api.get('/api/does-not-exist');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'Not found');
    const { slug, auth } = await createBusiness(ctx.api);
    const bad = await ctx.api.put(`/api/businesses/${slug}/appointments/not-an-objectid`).set(auth).send({ notes: 'x' });
    assert.equal(bad.status, 400);
  });

  test('reminder settings are persisted (H-10)', async () => {
    const { slug, auth } = await createBusiness(ctx.api);
    const r = await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ reminderSettings: { '1day': false, '2hours': true, '30min': true, template: 'Hi {customer_name}', evil: { $set: 1 } } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.reminderSettings, { '1day': false, '2hours': true, '30min': true, template: 'Hi {customer_name}' });
  });
});
