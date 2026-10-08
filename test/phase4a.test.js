'use strict';
// Phase 4 round A: appointment detail actions — edit, owner move, no-show (P4-A1).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { setup, createBusiness, today, daysFromToday, fakePhone, T } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

const book = async (b, body) => {
  const r = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth)
    .send({ customerName: 'QA Test Cust', customerPhone: '0500000990', serviceId: String(b.business.services[0]._id), ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};

describe('P4-A1 edit', () => {
  test('owner corrects name/phone/notes; bad phone rejected', async () => {
    const b = await createBusiness(ctx.api);
    const a = await book(b, { date: daysFromToday(2), startTime: '10:00' });
    const put = (body) => ctx.api.put(`/api/businesses/${b.slug}/appointments/${a._id}`).set(b.auth).send(body);
    let r = await put({ customerName: 'QA Test Fixed', customerPhone: '0521234567', notes: 'אלרגיה' });
    assert.equal(r.status, 200); assert.equal(r.body.customerName, 'QA Test Fixed'); assert.equal(r.body.customerPhone, '0521234567'); assert.equal(r.body.notes, 'אלרגיה');
    assert.equal(r.body.duration, 30);
    r = await put({ customerPhone: '123' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_phone');
    r = await put({ customerName: '  ' }); assert.equal(r.status, 400);
  });
});

describe('P4-A1 move', () => {
  test('moves with conflict check, keeps staff, resets reminders; cannot move into the past or onto a booked slot', async () => {
    const b = await createBusiness(ctx.api);
    const a = await book(b, { date: daysFromToday(2), startTime: '10:00' });
    const other = await book(b, { date: daysFromToday(3), startTime: '12:00' });
    await ctx.db.collection('appointments').updateOne({ _id: new ObjectId(a._id) }, { $set: { reminders: { '1day': true } } });
    const move = (id, body) => ctx.api.post(`/api/businesses/${b.slug}/appointments/${id}/move`).set(b.auth).send(body);
    let r = await move(a._id, { date: daysFromToday(3), startTime: '12:15' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'conflict');
    r = await move(a._id, { date: daysFromToday(-1), startTime: '12:00' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'past');
    r = await move(a._id, { date: daysFromToday(3), startTime: '13:00' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.date, daysFromToday(3)); assert.equal(r.body.startTime, '13:00'); assert.equal(r.body.endTime, '13:30');
    assert.equal(r.body.movedFrom.date, daysFromToday(2));
    const raw = await ctx.db.collection('appointments').findOne({ _id: new ObjectId(a._id) });
    assert.equal(raw.reminders, undefined, 'reminders reset');
    // owner may move outside hours (late evening)
    r = await move(a._id, { date: daysFromToday(3), startTime: '22:00' });
    assert.equal(r.status, 200);
    // cancelled cannot be moved
    await ctx.api.delete(`/api/businesses/${b.slug}/appointments/${other._id}`).set(b.auth);
    r = await move(other._id, { date: daysFromToday(4), startTime: '12:00' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'not_movable');
    // other business cannot move it
    const x = await createBusiness(ctx.api);
    r = await ctx.api.post(`/api/businesses/${x.slug}/appointments/${a._id}/move`).set(x.auth).send({ date: daysFromToday(4), startTime: '12:00' });
    assert.equal(r.status, 404);
  });

  test('a pending customer reschedule request is superseded by the owner move', async () => {
    const b = await createBusiness(ctx.api);
    const a = await book(b, { date: daysFromToday(2), startTime: '10:00' });
    await ctx.api.post(`/api/businesses/${b.slug}/appointments/${a._id}/reschedule`).set(b.auth).send({ requestedDate: daysFromToday(4), requestedTime: '11:00' });
    const r = await ctx.api.post(`/api/businesses/${b.slug}/appointments/${a._id}/move`).set(b.auth).send({ date: daysFromToday(5), startTime: '09:00' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'confirmed');
    assert.equal(r.body.rescheduleRequest.status, 'superseded');
  });
});

describe('P4-A1 no-show', () => {
  test('only after the start; excluded from revenue and counts, reported separately', async () => {
    const b = await createBusiness(ctx.api);
    const fut = await book(b, { date: daysFromToday(2), startTime: '10:00' });
    let r = await ctx.api.put(`/api/businesses/${b.slug}/appointments/${fut._id}`).set(b.auth).send({ status: 'no_show' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'not_started');
    // a past appointment today at 00:00 (inserted directly; booking the past is not allowed)
    const doc = { businessId: new ObjectId(b.business._id), customerName: 'QA Test NS', customerPhone: '0500000991', serviceId: String(b.business.services[1]._id), serviceName: 'x', date: today(), startTime: '00:00', endTime: '00:45', duration: 45, price: 80, status: 'confirmed', createdAt: new Date() };
    const ins = await ctx.db.collection('appointments').insertOne(doc);
    let s = (await ctx.api.get(`/api/businesses/${b.slug}/stats`).set(b.auth)).body;
    const revBefore = s.todayRevenue;
    r = await ctx.api.put(`/api/businesses/${b.slug}/appointments/${ins.insertedId}`).set(b.auth).send({ status: 'no_show' });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'no_show');
    s = (await ctx.api.get(`/api/businesses/${b.slug}/stats`).set(b.auth)).body;
    assert.equal(s.todayRevenue, revBefore - 80);
    assert.equal(s.weekNoShows, 1);
    const ext = (await ctx.api.get(`/api/businesses/${b.slug}/stats/extended`).set(b.auth)).body;
    assert.equal(ext.monthNoShows, 1);
  });
});

describe('P4-A1 customer history + P4-A2 reserved slug', () => {
  test('customer page lists every appointment (any status, newest first) with price/duration', async () => {
    const b = await createBusiness(ctx.api);
    const a1 = await book(b, { date: daysFromToday(2), startTime: '10:00' });
    const a2 = await book(b, { date: daysFromToday(3), startTime: '11:00' });
    await ctx.api.delete(`/api/businesses/${b.slug}/appointments/${a1._id}`).set(b.auth).send({});
    const list = await ctx.api.get(`/api/businesses/${b.slug}/customers`).set(b.auth);
    const c = list.body.find((x) => x.phone === '0500000990');
    assert.ok(c, 'customer exists');
    const r = await ctx.api.get(`/api/businesses/${b.slug}/customers/${c._id}`).set(b.auth);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.visits.map((v) => String(v._id)), [String(a2._id), String(a1._id)]);
    assert.equal(r.body.visits[1].status, 'cancelled');
    assert.equal(typeof r.body.visits[0].price, 'number');
    assert.equal(typeof r.body.visits[0].duration, 'number');
  });
  test('"more" (owner tab route) cannot be a booking link', async () => {
    const r = await ctx.api.get('/api/check-username/more');
    assert.equal(r.status, 200);
    assert.equal(r.body.available, false);
    assert.equal(r.body.reason, 'reserved');
  });
});
