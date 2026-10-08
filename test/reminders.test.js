'use strict';
// C-4: reminder endpoints require the cron secret, no open relay, no PII to strangers;
// M-22: due reminders are computed in the business time zone.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { setup, createBusiness, T, TZ } = require('./helpers');
const reminders = require('../lib/reminders');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

const CRON = { 'X-Cron-Secret': 'test-cron-secret' };

/** Insert an appointment that starts `minutesFromNow` minutes from now (business-local wall clock). */
async function apptIn(biz, minutesFromNow, extra = {}) {
  const local = T.nowInTz(TZ, Date.now() + minutesFromNow * 60000);
  const doc = {
    businessId: new ObjectId(biz._id), serviceName: 'QA Haircut', customerName: 'QA Test Rem', customerPhone: '0500000951',
    date: local.date, startTime: local.time, endTime: local.time, status: 'confirmed', createdAt: new Date(), ...extra,
  };
  const r = await ctx.db.collection('appointments').insertOne(doc);
  return { ...doc, _id: r.insertedId };
}

describe('reminder endpoint auth (C-4)', () => {
  test('no secret / wrong secret → 401 on every scheduler endpoint', async () => {
    for (const p of ['/api/reminders/check', '/api/reminders/process', '/api/reminders/mark-sent']) {
      assert.equal((await ctx.api.post(p).send({})).status, 401, p);
      assert.equal((await ctx.api.post(p).set({ 'X-Cron-Secret': 'nope' }).send({})).status, 401, p);
    }
  });

  test('owner tokens are not accepted as the cron secret', async () => {
    const { auth } = await createBusiness(ctx.api);
    assert.equal((await ctx.api.post('/api/reminders/check').set(auth)).status, 401);
  });

  test('the open SMS/WhatsApp relay /api/reminders/send is gone', async () => {
    assert.equal((await ctx.api.post('/api/reminders/send').send({ phone: '0500000950', message: 'spam' })).status, 404);
    assert.equal((await ctx.api.post('/api/reminders/send').set(CRON).send({ phone: '0500000950', message: 'spam' })).status, 404);
  });

  test('endpoints are disabled (503) when REMINDER_CRON_SECRET is not configured', async () => {
    const saved = process.env.REMINDER_CRON_SECRET;
    delete process.env.REMINDER_CRON_SECRET;
    try {
      assert.equal((await ctx.api.post('/api/reminders/check').set(CRON)).status, 503);
    } finally { process.env.REMINDER_CRON_SECRET = saved; }
  });

  test('with the secret: check returns due reminders, mark-sent validates input', async () => {
    const { business } = await createBusiness(ctx.api);
    const appt = await apptIn(business, 1440 - 5); // ~24h from now → "1day" window
    const r = await ctx.api.post('/api/reminders/check').set(CRON);
    assert.equal(r.status, 200);
    const mine = r.body.reminders.filter(x => x.appointmentId === appt._id.toString());
    assert.equal(mine.length, 1);
    assert.equal(mine[0].intervalKey, '1day');
    assert.match(mine[0].message, /QA Test Rem/);
    assert.equal((await ctx.api.post('/api/reminders/mark-sent').set(CRON).send({ appointmentId: 'bad', intervalKey: '1day' })).status, 400);
    assert.equal((await ctx.api.post('/api/reminders/mark-sent').set(CRON).send({ appointmentId: appt._id.toString(), intervalKey: '$where' })).status, 400);
    assert.equal((await ctx.api.post('/api/reminders/mark-sent').set(CRON).send({ appointmentId: appt._id.toString(), intervalKey: '1day' })).status, 200);
    const again = await ctx.api.post('/api/reminders/check').set(CRON);
    assert.equal(again.body.reminders.filter(x => x.appointmentId === appt._id.toString()).length, 0);
  });
});

describe('due computation (time zone + window)', () => {
  test('uses business-local time: an appointment 2h from now (Israel time) is due for "2hours", not 3h later', async () => {
    const { business } = await createBusiness(ctx.api);
    const appt = await apptIn(business, 115);
    const due = await reminders.findDue(ctx.db);
    const mine = due.filter(d => d.appt._id.equals(appt._id));
    assert.deepEqual(mine.map(d => d.key), ['2hours']);
  });

  test('a missed tick does not skip the reminder (window, not exact minute)', async () => {
    const { business } = await createBusiness(ctx.api);
    const appt = await apptIn(business, 1440 - 9);
    const due = await reminders.findDue(ctx.db);
    assert.ok(due.some(d => d.appt._id.equals(appt._id) && d.key === '1day'));
  });

  test('respects reminderSettings (owner turned reminders off)', async () => {
    const { business, slug, auth } = await createBusiness(ctx.api);
    await ctx.api.put(`/api/businesses/${slug}`).set(auth).send({ reminderSettings: { '1day': false, '2hours': false, '30min': false } });
    const appt = await apptIn(business, 115);
    const due = await reminders.findDue(ctx.db);
    assert.equal(due.filter(d => d.appt._id.equals(appt._id) && d.wantsWhatsApp).length, 0);
  });

  test('scheduler: push reminders are sent once; customer reminders left for the external cron without a provider', async () => {
    const { business } = await createBusiness(ctx.api);
    const appt = await apptIn(business, 1440 - 3);
    const pushes = [];
    const notify = async (bid, payload) => { pushes.push({ bid: String(bid), payload }); };
    const noProvider = { isConfigured: () => false, sendReminder: async () => { throw new Error('must not send'); } };
    const r1 = await reminders.runOnce({ db: ctx.db, notifyBusiness: notify, reminderService: noProvider });
    const r2 = await reminders.runOnce({ db: ctx.db, notifyBusiness: notify, reminderService: noProvider });
    assert.equal(pushes.filter(p => p.bid === String(business._id)).length, 1, 'push deduplicated');
    assert.ok(r1.customer.skipped >= 1 && r2.pushSent === 0);
    const doc = await ctx.db.collection('appointments').findOne({ _id: appt._id });
    assert.equal(doc.pushReminders['1day'], true);
    assert.equal(doc.reminders, undefined, 'customer reminder not claimed');
  });

  test('scheduler with a provider sends and marks customer reminders; failures are retried', async () => {
    const { business } = await createBusiness(ctx.api);
    const appt = await apptIn(business, 30 - 2, { customerPhone: '0500000952' });
    const sent = [];
    let fail = true;
    const provider = { isConfigured: () => true, sendReminder: async (to, msg) => { if (fail) return { success: false }; sent.push({ to, msg }); return { success: true }; } };
    await reminders.runOnce({ db: ctx.db, notifyBusiness: async () => {}, reminderService: provider });
    assert.equal(sent.filter(s => s.to === '0500000952').length, 0);
    let doc = await ctx.db.collection('appointments').findOne({ _id: appt._id });
    assert.equal(doc.reminders && doc.reminders['30min'], undefined, 'unclaimed after failure');
    // 30min reminders are off by default; enable for this business
    await ctx.db.collection('businesses').updateOne({ _id: new ObjectId(business._id) }, { $set: { reminderSettings: { '30min': true } } });
    fail = false;
    await reminders.runOnce({ db: ctx.db, notifyBusiness: async () => {}, reminderService: provider });
    await reminders.runOnce({ db: ctx.db, notifyBusiness: async () => {}, reminderService: provider });
    assert.equal(sent.filter(s => s.to === '0500000952').length, 1);
    doc = await ctx.db.collection('appointments').findOne({ _id: appt._id });
    assert.equal(doc.reminders['30min'], true);
  });

  test('Mongo lock: only one holder at a time, re-entrant for the owner, free after expiry', async () => {
    assert.equal(await reminders.acquireLock(ctx.db, 'test-lock', 'a', 60000), true);
    assert.equal(await reminders.acquireLock(ctx.db, 'test-lock', 'b', 60000), false);
    assert.equal(await reminders.acquireLock(ctx.db, 'test-lock', 'a', 60000), true);
    await ctx.db.collection('locks').updateOne({ _id: 'test-lock' }, { $set: { lockedUntil: new Date(Date.now() - 1) } });
    assert.equal(await reminders.acquireLock(ctx.db, 'test-lock', 'b', 60000), true);
  });
});

describe('time helpers', () => {
  test('zonedTimeToUtcMs handles Israel DST', () => {
    // 2026-07-01 12:00 IDT = 09:00 UTC; 2026-12-01 12:00 IST = 10:00 UTC
    assert.equal(new Date(T.zonedTimeToUtcMs('2026-07-01', '12:00', TZ)).toISOString(), '2026-07-01T09:00:00.000Z');
    assert.equal(new Date(T.zonedTimeToUtcMs('2026-12-01', '12:00', TZ)).toISOString(), '2026-12-01T10:00:00.000Z');
  });
  test('todayInTz is the Israel date just after midnight Israel time (H-11 / C-5)', () => {
    // 2026-10-07T21:30Z = 2026-10-08 00:30 in Israel
    assert.equal(T.todayInTz(TZ, Date.parse('2026-10-07T21:30:00Z')), '2026-10-08');
  });
});
