'use strict';
// M-12: express-rate-limit store backed by MongoDB (fixed windows, shared by every instance and
// surviving restarts). Falls back to counting in memory until the DB is connected.
class MongoRateStore {
  constructor(getDb, prefix) { this.getDb = getDb; this.prefix = prefix; this.mem = new Map(); }
  init(options) { this.windowMs = options.windowMs; }
  _id(key, bucket) { return `erl:${this.prefix}:${key}|${this.windowMs}|${bucket}`; }
  async increment(key) {
    const now = Date.now();
    const bucket = Math.floor(now / this.windowMs);
    const resetTime = new Date((bucket + 1) * this.windowMs);
    const db = this.getDb();
    if (!db) {
      const k = this._id(key, bucket);
      const n = (this.mem.get(k) || 0) + 1; this.mem.set(k, n);
      return { totalHits: n, resetTime };
    }
    const doc = await db.collection('rate_limits').findOneAndUpdate(
      { _id: this._id(key, bucket) },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetTime.getTime() + 60000) } },
      { upsert: true, returnDocument: 'after' });
    return { totalHits: doc ? doc.count : 1, resetTime };
  }
  async decrement(key) {
    const db = this.getDb(); if (!db) return;
    const bucket = Math.floor(Date.now() / this.windowMs);
    await db.collection('rate_limits').updateOne({ _id: this._id(key, bucket) }, { $inc: { count: -1 } });
  }
  async resetKey(key) {
    const db = this.getDb(); if (!db) return;
    const bucket = Math.floor(Date.now() / this.windowMs);
    await db.collection('rate_limits').deleteOne({ _id: this._id(key, bucket) });
  }
}
module.exports = { MongoRateStore };
