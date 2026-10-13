'use strict';
// Sprint 2: recurring bookings (owner only), conflicts skipped, cancel the rest of a series.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, daysFromToday } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

describe('S2 recurring bookings', () => {
  test('weekly x4 with one conflict skipped; cancel-series from the 2nd', async () => {
    const b = await createBusiness(ctx.api);
    await ctx.api.put(`/api/businesses/${b.slug}`).set(b.auth).send({ workingHours: Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(d => [d, { enabled: true, start: '08:00', end: '20:00' }])) });
    const svc = String(b.business.services[0]._id);
    const d0 = daysFromToday(2);
    const book = (body) => ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: 'QA Test Weekly', customerPhone: '0500000996', serviceId: svc, startTime: '10:00', ...body });
    // block week 3
    const d2 = daysFromToday(16);
    assert.equal((await book({ date: d2, customerName: 'QA Blocker', customerPhone: '0500000997' })).status, 201);
    const r = await book({ date: d0, repeat: { everyWeeks: 1, count: 4 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.series.created.length, 3);
    assert.deepEqual(r.body.series.skipped.map(x => x.date), [d2]);
    assert.equal(r.body.series.skipped[0].code, 'conflict');
    const list = (await ctx.api.get(`/api/businesses/${b.slug}/appointments`).set(b.auth)).body.filter(a => a.seriesId === r.body.series.id);
    assert.equal(list.length, 3);
    // invalid repeat ignored → single booking
    const single = await book({ date: daysFromToday(3), repeat: { everyWeeks: 9, count: 100 } });
    assert.equal(single.status, 201); assert.equal(single.body.series, undefined);
    // public bookings cannot repeat
    const tok = (await ctx.api.get(`/api/businesses/${b.slug}/booking-token`)).body.token;
    const pub = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).send({ bookingToken: tok, customerName: 'QA P', customerPhone: '0500000998', serviceId: svc, date: daysFromToday(4), startTime: '12:00', repeat: { everyWeeks: 1, count: 3 } });
    assert.equal(pub.status, 201); assert.equal(pub.body.series, undefined);
    // cancel from the 2nd → 2 cancelled, 1st stays
    const second = r.body.series.created[1].id;
    const c = await ctx.api.post(`/api/businesses/${b.slug}/appointments/${second}/cancel-series`).set(b.auth).send({});
    assert.equal(c.status, 200); assert.equal(c.body.cancelled, 2);
    const after = (await ctx.api.get(`/api/businesses/${b.slug}/appointments`).set(b.auth)).body.filter(a => a.seriesId === r.body.series.id);
    assert.deepEqual(after.map(a => a.status).sort(), ['cancelled', 'cancelled', 'pending']);
    assert.equal((await ctx.api.post(`/api/businesses/${b.slug}/appointments/${single.body.id}/cancel-series`).set(b.auth)).status, 400);
    const o = await createBusiness(ctx.api);
    assert.equal((await ctx.api.post(`/api/businesses/${o.slug}/appointments/${second}/cancel-series`).set(o.auth)).status, 404);
  });
});
