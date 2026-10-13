'use strict';
// Sprint 3: subscription period. Every business gets a free first year from its creation date.
// No billing yet: nothing is blocked when the trial ends (payment provider pending — see user inputs).
const TRIAL_DAYS = 365;
const DAY = 864e5;

function createdAtOf(b) {
  if (b && b.createdAt) { const d = new Date(b.createdAt); if (!isNaN(d)) return d; }
  if (b && b._id && typeof b._id.getTimestamp === 'function') return b._id.getTimestamp();
  return new Date();
}
function trialFieldsFor(b) {
  const start = createdAtOf(b);
  return { trialStartedAt: start, trialEndsAt: new Date(start.getTime() + TRIAL_DAYS * DAY) };
}
/** { startedAt, endsAt, daysLeft, active, plan } — computed even before the backfill ran. */
function trialOf(b, nowMs = Date.now()) {
  const f = b && b.trialEndsAt ? { trialStartedAt: new Date(b.trialStartedAt || createdAtOf(b)), trialEndsAt: new Date(b.trialEndsAt) } : trialFieldsFor(b);
  const daysLeft = Math.max(0, Math.ceil((f.trialEndsAt.getTime() - nowMs) / DAY));
  return { plan: (b && b.plan) || 'trial', startedAt: f.trialStartedAt, endsAt: f.trialEndsAt, daysLeft, active: daysLeft > 0 };
}
/** Idempotent backfill: businesses without trial fields get them from their creation date. */
async function backfill(db, log = console.log) {
  const cur = db.collection('businesses').find({ trialEndsAt: { $exists: false } }, { projection: { _id: 1, createdAt: 1 } });
  let n = 0;
  for await (const b of cur) {
    const r = await db.collection('businesses').updateOne({ _id: b._id, trialEndsAt: { $exists: false } }, { $set: trialFieldsFor(b) });
    n += r.modifiedCount;
  }
  if (n) log(`[trial] backfilled ${n} business(es)`);
  return n;
}
module.exports = { TRIAL_DAYS, trialOf, trialFieldsFor, backfill };
