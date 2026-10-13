'use strict';
// Sprint 1 F3: rich customer profile fields (tags, birthday, pinned note, source, marketing consent,
// preferred staff) + no-show count. Old customer documents without the fields still work.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, daysFromToday } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

describe('S1-F3 customer profile', () => {
  test('create + update the new fields, validation, no-show count', async () => {
    const b = await createBusiness(ctx.api);
    let r = await ctx.api.post(`/api/businesses/${b.slug}/customers`).set(b.auth).send({ name: 'QA Test Rina', phone: '0500000971', source: 'instagram', tags: ['VIP ', 'vip', 'Color'] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.source, 'instagram');
    assert.deepEqual(r.body.tags, ['VIP', 'Color']);
    const id = r.body._id || r.body.id;
    const put = (body) => ctx.api.put(`/api/businesses/${b.slug}/customers/${id}`).set(b.auth).send(body);
    r = await put({ birthday: '03-14', pinnedNote: 'Allergic to ammonia', marketingConsent: true, preferredStaffId: 'abc' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.birthday, '03-14');
    assert.equal(r.body.pinnedNote, 'Allergic to ammonia');
    assert.equal(r.body.marketingConsent, true);
    assert.ok(r.body.marketingConsentAt);
    r = await put({ marketingConsent: false });
    assert.equal(r.body.marketingConsent, false); assert.equal(r.body.marketingConsentAt, null);
    assert.equal((await put({ birthday: '1990-03-14' })).status, 400);
    assert.equal((await put({ birthday: '13-01' })).status, 400);
    assert.equal((await put({ source: 'tv' })).status, 400);
    assert.equal((await put({ tags: 'x' })).status, 400);
    assert.equal((await put({ pinnedNote: 'x'.repeat(400) })).body.pinnedNote.length, 300);
    assert.equal((await put({ birthday: '' })).body.birthday, '');
    // no-show count from the visit history
    const svc = String(b.business.services[0]._id);
    const a = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: 'QA Test Rina', customerPhone: '0500000971', serviceId: svc, date: daysFromToday(-2), startTime: '10:00' });
    if (a.status === 201) {
      const aid = a.body._id || a.body.id;
      await ctx.api.put(`/api/businesses/${b.slug}/appointments/${aid}`).set(b.auth).send({ status: 'no_show' });
    }
    r = await ctx.api.get(`/api/businesses/${b.slug}/customers/${id}`).set(b.auth);
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.noShowCount, 'number');
    if (a.status === 201) assert.equal(r.body.noShowCount, 1);
  });
  test('another business cannot read or edit the profile', async () => {
    const a = await createBusiness(ctx.api), b = await createBusiness(ctx.api);
    const r = await ctx.api.post(`/api/businesses/${a.slug}/customers`).set(a.auth).send({ name: 'QA Test X', phone: '0500000972' });
    const id = r.body._id || r.body.id;
    assert.equal((await ctx.api.put(`/api/businesses/${b.slug}/customers/${id}`).set(b.auth).send({ pinnedNote: 'x' })).status, 404);
    assert.equal((await ctx.api.put(`/api/businesses/${a.slug}/customers/${id}`).set(b.auth).send({ pinnedNote: 'x' })).status, 403);
  });
});
