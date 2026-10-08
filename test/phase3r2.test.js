'use strict';
// Phase 3 round 2: derived duration/price (M-13), one stats definition (L-6), owner staff list and
// per-staff hours (M-17).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { setup, createBusiness, today, T } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

async function insertAppt(b, fields) {
  const doc = {
    businessId: new ObjectId(b.business._id), customerName: 'QA Test Legacy', customerPhone: '0500000991',
    serviceName: 'QA Haircut', date: today(), startTime: '10:00', status: 'confirmed', createdAt: new Date(), ...fields,
  };
  await ctx.db.collection('appointments').insertOne(doc);
  return doc;
}

describe('M-13 duration and price for older appointments', () => {
  test('derived from end − start, then from the service', async () => {
    const b = await createBusiness(ctx.api);
    const [s30, s45, s60] = b.business.services;
    await insertAppt(b, { startTime: '10:00', endTime: '10:45', serviceId: String(s45._id), serviceName: s45.name });
    await insertAppt(b, { startTime: '12:00', serviceId: String(s60._id), serviceName: s60.name });
    await insertAppt(b, { startTime: '14:00', endTime: '14:30', serviceName: s30.name, duration: 50, price: 99 });
    const r = await ctx.api.get(`/api/businesses/${b.slug}/appointments`).set(b.auth);
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.map(a => [a.startTime, a]));
    assert.equal(by['10:00'].duration, 45); assert.equal(by['10:00'].price, 80);
    assert.equal(by['12:00'].duration, 60); assert.equal(by['12:00'].price, 120);
    assert.equal(by['14:00'].duration, 50, 'stored values win'); assert.equal(by['14:00'].price, 99);
  });
});

describe('L-6 one stats definition', () => {
  test('calendar week Sun–Sat, today numbers, revenue from confirmed/completed only', async () => {
    const b = await createBusiness(ctx.api);
    const [s30, s45] = b.business.services;
    const t0 = today();
    await insertAppt(b, { serviceId: String(s30._id), status: 'confirmed', startTime: '09:00' });           // 60, today
    await insertAppt(b, { serviceId: String(s45._id), status: 'pending', startTime: '11:00' });             // not revenue
    await insertAppt(b, { serviceId: String(s45._id), status: 'cancelled', startTime: '13:00' });           // cancelled
    await insertAppt(b, { serviceId: String(s30._id), status: 'completed', startTime: '15:00', price: 70 }); // 70, today
    const s1 = (await ctx.api.get(`/api/businesses/${b.slug}/stats`).set(b.auth)).body;
    assert.equal(T.dayNameOf(s1.weekFrom), 'sunday');
    assert.equal(s1.weekTo, T.addDays(s1.weekFrom, 6));
    assert.ok(s1.weekFrom <= t0 && t0 <= s1.weekTo);
    // one appointment last week must not count
    await insertAppt(b, { serviceId: String(s30._id), status: 'confirmed', date: T.addDays(s1.weekFrom, -1) });
    const s = (await ctx.api.get(`/api/businesses/${b.slug}/stats`).set(b.auth)).body;
    assert.equal(s.todayAppointments, 3, 'cancelled excluded');
    assert.equal(s.todayRevenue, 130);
    assert.equal(s.weekAppointments, 3);
    assert.equal(s.weekRevenue, 130);
    assert.equal(s.weekCancelled, 1);
    assert.equal(s.cancellationRate, 25);
    const ext = (await ctx.api.get(`/api/businesses/${b.slug}/stats/extended`).set(b.auth)).body;
    assert.ok(ext.monthRevenue >= 130);
    assert.equal(ext.busiestDayData.length, 7);
  });
});

describe('M-17 staff', () => {
  test('owner list includes inactive staff; hours are kept, set and cleared explicitly', async () => {
    const b = await createBusiness(ctx.api);
    const svc = String(b.business.services[0]._id);
    const hours = { sunday: { enabled: true, start: '10:00', end: '14:00' }, monday: { enabled: false, start: '09:00', end: '18:00' } };
    let r = await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: [
      { name: 'QA Dana', services: [svc], workingHours: hours },
      { name: 'QA Avi', isActive: false },
    ] });
    assert.equal(r.status, 200);
    const [dana, avi] = r.body.staff;
    assert.equal(dana.workingHours.sunday.start, '10:00');

    const pub = await ctx.api.get(`/api/businesses/${b.slug}/staff`);
    assert.deepEqual(pub.body.map(s => s.name), ['QA Dana'], 'public list hides inactive staff');
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}/staff/all`)).status, 401);
    const other = await createBusiness(ctx.api);
    assert.ok([401, 403].includes((await ctx.api.get(`/api/businesses/${b.slug}/staff/all`).set(other.auth)).status));
    const all = await ctx.api.get(`/api/businesses/${b.slug}/staff/all`).set(b.auth);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.map(s => [s.name, s.isActive]), [['QA Dana', true], ['QA Avi', false]]);
    assert.deepEqual(all.body[0].services, [svc]);

    // omitted hours are kept
    r = await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: [
      { _id: dana._id, name: 'QA Dana', services: [svc] }, { _id: avi._id, name: 'QA Avi', isActive: true },
    ] });
    assert.equal(r.body.staff[0].workingHours.sunday.end, '14:00');
    // null clears (follow the business hours)
    r = await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: [
      { _id: dana._id, name: 'QA Dana', services: [svc], workingHours: null }, { _id: avi._id, name: 'QA Avi' },
    ] });
    assert.equal(r.body.staff[0].workingHours, undefined);
    assert.equal(String(r.body.staff[0]._id), String(dana._id), 'ids are stable');
  });
});
