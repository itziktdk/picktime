'use strict';
// Sprint 1 F5: subscribable ICS feed per business / staff with a secret, revocable link.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, daysFromToday } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });
const tokenOf = (url) => url.split('/cal/')[1].replace('.ics', '');

describe('S1-F5 calendar feed', () => {
  test('owner feed: names hidden by default, staff feed filtered, regenerate + revoke', async () => {
    const b = await createBusiness(ctx.api);
    await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: [{ name: 'QA Dana', isActive: true }, { name: 'QA Avi', isActive: true }] });
    const me = (await ctx.api.get('/api/auth/me').set(b.auth)).body;
    const [dana, avi] = me.staff.map(s => String(s.id || s._id));
    const svc = String(b.business.services[0]._id);
    const book = (staffId, startTime, name) => ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: name, customerPhone: '0500000975', serviceId: svc, date: daysFromToday(2), startTime, staffId });
    assert.equal((await book(dana, '10:00', 'QA Test Secret Name')).status, 201);
    assert.equal((await book(avi, '11:00', 'QA Test Avi Client')).status, 201);
    let r = await ctx.api.post(`/api/businesses/${b.slug}/calendar-feeds`).set(b.auth).send({});
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const ownerUrl = r.body.url; assert.match(ownerUrl, /\/cal\/[a-f0-9]{48}\.ics$/);
    let f = await ctx.api.get(`/cal/${tokenOf(ownerUrl)}.ics`);
    assert.equal(f.status, 200); assert.match(f.headers['content-type'], /text\/calendar/);
    assert.equal((f.text.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(!f.text.includes('Secret Name'), 'names hidden by default');
    assert.ok(f.text.includes('(QA Dana)'));
    // staff feed with names
    r = await ctx.api.post(`/api/businesses/${b.slug}/calendar-feeds`).set(b.auth).send({ staffId: dana, showNames: true });
    assert.equal(r.status, 201);
    f = await ctx.api.get(`/cal/${tokenOf(r.body.url)}.ics`);
    assert.equal((f.text.match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.ok(f.text.includes('QA Test Secret Name'));
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}/calendar-feeds`).set(b.auth)).body.length, 2);
    // regenerate owner link: old one stops working
    r = await ctx.api.post(`/api/businesses/${b.slug}/calendar-feeds`).set(b.auth).send({});
    assert.equal((await ctx.api.get(`/cal/${tokenOf(ownerUrl)}.ics`)).status, 404);
    assert.equal((await ctx.api.get(`/cal/${tokenOf(r.body.url)}.ics`)).status, 200);
    // revoke
    assert.equal((await ctx.api.delete(`/api/businesses/${b.slug}/calendar-feeds/${r.body.id}`).set(b.auth)).status, 200);
    assert.equal((await ctx.api.get(`/cal/${tokenOf(r.body.url)}.ics`)).status, 404);
    assert.equal((await ctx.api.post(`/api/businesses/${b.slug}/calendar-feeds`).set(b.auth).send({ staffId: 'nope' })).status, 400);
    assert.equal((await ctx.api.get('/cal/zzz.ics')).status, 404);
  });
  test('isolation + cleanup on account delete', async () => {
    const a = await createBusiness(ctx.api), b = await createBusiness(ctx.api);
    const r = await ctx.api.post(`/api/businesses/${a.slug}/calendar-feeds`).set(a.auth).send({});
    assert.equal((await ctx.api.delete(`/api/businesses/${b.slug}/calendar-feeds/${r.body.id}`).set(b.auth)).status, 404);
    assert.equal((await ctx.api.get(`/api/businesses/${a.slug}/calendar-feeds`).set(b.auth)).status, 403);
    assert.equal((await ctx.api.delete('/api/account').set(a.auth).send({ confirmSlug: a.slug })).status, 200);
    assert.equal((await ctx.api.get(`/cal/${tokenOf(r.body.url)}.ics`)).status, 404);
  });
});
