'use strict';
// Sprint 2: two-way calendar sync (Google path with a stubbed provider). Flags off → hidden / 404.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, daysFromToday } = require('./helpers');

let ctx; const realFetch = global.fetch;
const ENV = { GOOGLE_CALENDAR_SYNC_ENABLED: 'true', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', CALSYNC_ENC_KEY: 'k'.repeat(40) };
before(async () => { ctx = await setup(); });
after(async () => { global.fetch = realFetch; for (const k of Object.keys(ENV)) delete process.env[k]; await ctx.teardown(); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe('S2 calendar sync', () => {
  test('off by default; connect → callback → push events; busy blocks online slots; disconnect', async () => {
    const b = await createBusiness(ctx.api);
    assert.deepEqual((await ctx.api.get('/api/features')).body, { googleCalendarSync: false, outlookCalendarSync: false, whatsappReplies: false });
    assert.equal((await ctx.api.post(`/api/businesses/${b.slug}/calendar-sync/google/connect`).set(b.auth)).status, 404);
    Object.assign(process.env, ENV);
    assert.equal((await ctx.api.get('/api/features')).body.googleCalendarSync, true);
    const r = await ctx.api.post(`/api/businesses/${b.slug}/calendar-sync/google/connect`).set(b.auth);
    assert.equal(r.status, 200);
    const u = new URL(r.body.url);
    assert.equal(u.hostname, 'accounts.google.com'); assert.equal(u.searchParams.get('access_type'), 'offline');
    const state = u.searchParams.get('state');
    const day = daysFromToday(3);
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      url = String(url); calls.push(`${opts.method || 'GET'} ${url.split('?')[0]}`);
      const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
      if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
      if (url.includes('/calendars/primary/events') && (opts.method || 'GET') === 'GET')
        return json({ items: [{ id: 'x1', status: 'confirmed', start: { dateTime: `${day}T12:00:00+03:00` }, end: { dateTime: `${day}T13:00:00+03:00` } },
          { id: 'mine', status: 'confirmed', extendedProperties: { private: { snaptorId: 'abc' } }, start: { dateTime: `${day}T15:00:00+03:00` }, end: { dateTime: `${day}T16:00:00+03:00` } }] });
      if (url.includes('/calendars/primary/events') && opts.method === 'POST') return json({ id: 'ev1' });
      if (url.includes('/calendars/primary/events/') && opts.method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
      return realFetch(url, opts);
    };
    const cb = await ctx.api.get(`/api/calendar-sync/google/callback?code=c0de&state=${encodeURIComponent(state)}`);
    assert.equal(cb.status, 302); assert.match(cb.headers.location, /calsync=ok/);
    assert.equal((await ctx.api.get(`/api/calendar-sync/google/callback?code=c0de&state=forged`)).headers.location, '/settings?calsync=expired');
    const st = (await ctx.api.get(`/api/businesses/${b.slug}/calendar-sync`).set(b.auth)).body;
    assert.equal(st.find(x => x.provider === 'google').connected, true);
    const conn = await ctx.db.collection('calendar_connections').findOne({ provider: 'google' });
    assert.ok(conn.refreshToken && !conn.refreshToken.includes('RT'), 'refresh token encrypted');
    // push
    const svc = String(b.business.services[0]._id);
    const a = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: 'QA Sync', customerPhone: '0500000989', serviceId: svc, date: day, startTime: '10:00' });
    assert.equal(a.status, 201);
    await sleep(300);
    const { ObjectId } = require('mongodb');
    let doc = await ctx.db.collection('appointments').findOne({ _id: new ObjectId(a.body.id) });
    assert.equal(doc.extEvents.google, 'ev1');
    // pull: 12:00 blocked for customers, 15:00 (our own event) not
    const av = (await ctx.api.get(`/api/businesses/${b.slug}/availability?date=${day}&serviceId=${svc}`)).body;
    const slot = (t) => (av.slots || []).find(s => s.start === t || s.time === t);
    assert.equal(slot('12:00').available, false);
    assert.equal(slot('15:00').available, true);
    // cancel → delete event
    await ctx.api.delete(`/api/businesses/${b.slug}/appointments/${a.body.id}`).set(b.auth);
    await sleep(300);
    doc = await ctx.db.collection('appointments').findOne({ _id: new ObjectId(a.body.id) });
    assert.equal(doc.extEvents.google, undefined);
    assert.ok(calls.some(c => c.startsWith('DELETE')));
    // disconnect
    assert.equal((await ctx.api.delete(`/api/businesses/${b.slug}/calendar-sync/google`).set(b.auth)).status, 200);
    assert.equal(await ctx.db.collection('calendar_connections').countDocuments({}), 0);
    // flag off again → availability ignores (no connection anyway), connect 404
    for (const k of Object.keys(ENV)) delete process.env[k];
    assert.equal((await ctx.api.post(`/api/businesses/${b.slug}/calendar-sync/google/connect`).set(b.auth)).status, 404);
  });
});
