'use strict';
// Sprint 2: opt-in waitlist. Off by default (404), public join with dedupe, owner list / mark booked, cascade on delete.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, daysFromToday } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

describe('S2 waitlist', () => {
  test('off by default, opt in, join + dedupe, owner list, mark booked, validation', async () => {
    const b = await createBusiness(ctx.api);
    const day = daysFromToday(3);
    const join = (body) => ctx.api.post(`/api/businesses/${b.slug}/waitlist`).send({ name: 'QA Test Wait', phone: '050-000-0991', date: day, ...body });
    assert.equal((await join({})).status, 404);
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}`)).body.waitlistEnabled, false);
    assert.equal((await ctx.api.put(`/api/businesses/${b.slug}`).set(b.auth).send({ bookingPolicy: { waitlistEnabled: true } })).status, 200);
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}`)).body.waitlistEnabled, true);
    let r = await join({ timePref: 'morning', serviceId: String(b.business.services[0]._id) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await join({ timePref: 'evening', note: 'any stylist' });
    assert.equal(r.status, 200); assert.equal(r.body.updated, true);
    assert.equal((await join({ phone: '123' })).status, 400);
    assert.equal((await join({ date: daysFromToday(-1) })).status, 400);
    assert.equal((await join({ name: '' })).status, 400);
    let list = (await ctx.api.get(`/api/businesses/${b.slug}/waitlist`).set(b.auth)).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].phone, '0500000991'); assert.equal(list[0].timePref, 'evening'); assert.equal(list[0].note, 'any stylist');
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}/waitlist?date=${day}`).set(b.auth)).body.length, 1);
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}/waitlist`)).status, 401);
    r = await ctx.api.put(`/api/businesses/${b.slug}/waitlist/${list[0].id}`).set(b.auth).send({ status: 'booked' });
    assert.equal(r.status, 200);
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}/waitlist`).set(b.auth)).body.length, 0);
    assert.equal((await ctx.api.put(`/api/businesses/${b.slug}/waitlist/${list[0].id}`).set(b.auth).send({ status: 'nope' })).status, 400);
    // other owner cannot touch it
    const o = await createBusiness(ctx.api);
    assert.equal((await ctx.api.put(`/api/businesses/${o.slug}/waitlist/${list[0].id}`).set(o.auth).send({ status: 'open' })).status, 404);
    // cancelling a booking that day with people waiting does not fail
    await join({ phone: '0500000992' });
    const a = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: 'QA C', customerPhone: '0500000993', serviceId: String(b.business.services[0]._id), date: day, startTime: '10:00' });
    assert.equal((await ctx.api.delete(`/api/businesses/${b.slug}/appointments/${a.body.id}`).set(b.auth)).status, 200);
    // account delete cascades
    assert.equal((await ctx.api.delete('/api/account').set(b.auth).send({ confirmSlug: b.slug })).status, 200);
    assert.equal(await ctx.db.collection('waitlist').countDocuments({ businessId: String(b.business._id) }), 0);
  });
});
