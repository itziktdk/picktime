'use strict';
// Sprint 3: one free year from creation; stored on create; backfilled for older businesses.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness } = require('./helpers');
const trial = require('../lib/trial');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

describe('S3 trial', () => {
  test('new business: trial stored, ~365 days left in /me', async () => {
    const b = await createBusiness(ctx.api);
    const doc = await ctx.db.collection('businesses').findOne({ slug: b.slug });
    assert.ok(doc.trialStartedAt && doc.trialEndsAt);
    assert.equal(Math.round((doc.trialEndsAt - doc.trialStartedAt) / 864e5), 365);
    const me = (await ctx.api.get('/api/auth/me').set(b.auth)).body;
    assert.ok(me.trial.daysLeft >= 364 && me.trial.daysLeft <= 365, String(me.trial.daysLeft));
    assert.equal(me.trial.active, true); assert.equal(me.trial.plan, 'trial');
    // public profile does not expose it
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}`)).body.trial, undefined);
  });
  test('backfill from createdAt, idempotent; expired → 0 days, inactive', async () => {
    const created = new Date(Date.now() - 400 * 864e5), created2 = new Date(Date.now() - 100 * 864e5);
    const r = await ctx.db.collection('businesses').insertMany([{ slug: 'qa-old-1', name: 'Old', createdAt: created }, { slug: 'qa-old-2', name: 'Old2', createdAt: created2 }]);
    assert.ok((await trial.backfill(ctx.db, () => {})) >= 2);
    assert.equal(await trial.backfill(ctx.db, () => {}), 0);
    const o1 = await ctx.db.collection('businesses').findOne({ _id: r.insertedIds[0] });
    assert.equal(o1.trialStartedAt.getTime(), created.getTime());
    const t1 = trial.trialOf(o1), t2 = trial.trialOf(await ctx.db.collection('businesses').findOne({ _id: r.insertedIds[1] }));
    assert.equal(t1.daysLeft, 0); assert.equal(t1.active, false);
    assert.equal(t2.daysLeft, 265);
  });
});
