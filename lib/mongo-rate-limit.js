'use strict';
// Fixed-window counters stored in MongoDB so limits hold across restarts and
// multiple instances (unlike the in-memory express-rate-limit store).

async function ensureIndexes(db) {
  await db.collection('rate_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

/**
 * Count one hit for `key` in the current window.
 * @returns {Promise<{count:number, allowed:boolean, retryAfterSec:number}>}
 */
async function hit(db, key, max, windowMs) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const _id = `${key}|${windowMs}|${bucket}`;
  const expiresAt = new Date((bucket + 1) * windowMs + 60 * 1000);
  let doc;
  for (let i = 0; i < 2; i++) {
    try {
      doc = await db.collection('rate_limits').findOneAndUpdate(
        { _id },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, returnDocument: 'after' }
      );
      break;
    } catch (err) {
      if (err && err.code === 11000 && i === 0) continue; // concurrent upsert race
      throw err;
    }
  }
  const count = doc ? doc.count : 1;
  return { count, allowed: count <= max, retryAfterSec: Math.ceil(((bucket + 1) * windowMs - now) / 1000) };
}

module.exports = { ensureIndexes, hit };
