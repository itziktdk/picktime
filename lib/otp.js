'use strict';
// One-time login codes: 6 digits, stored only as an HMAC, 5-minute expiry,
// max 5 wrong attempts per code, one active code per phone.
const crypto = require('crypto');

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

async function ensureIndexes(db) {
  await db.collection('otp_codes').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

function hashCode(secret, phoneKey, code) {
  return crypto.createHmac('sha256', secret).update(`${phoneKey}:${code}`).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function issue(db, secret, phoneKey) {
  const code = generateCode();
  const now = new Date();
  await db.collection('otp_codes').updateOne(
    { _id: phoneKey },
    { $set: { codeHash: hashCode(secret, phoneKey, code), attempts: 0, createdAt: now, expiresAt: new Date(now.getTime() + OTP_TTL_MS) } },
    { upsert: true }
  );
  return code;
}

/** @returns {Promise<'ok'|'invalid'|'expired'|'locked'>} */
async function verify(db, secret, phoneKey, code) {
  const col = db.collection('otp_codes');
  const doc = await col.findOne({ _id: phoneKey });
  if (!doc || !doc.expiresAt || doc.expiresAt.getTime() < Date.now()) return 'expired';
  if ((doc.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await col.deleteOne({ _id: phoneKey });
    return 'locked';
  }
  const expected = Buffer.from(doc.codeHash, 'hex');
  const actual = Buffer.from(hashCode(secret, phoneKey, String(code || '')), 'hex');
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!match) {
    const upd = await col.findOneAndUpdate({ _id: phoneKey }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (upd && upd.attempts >= OTP_MAX_ATTEMPTS) {
      await col.deleteOne({ _id: phoneKey });
      return 'locked';
    }
    return 'invalid';
  }
  // Single use: delete atomically; if someone else consumed it first, treat as expired.
  const del = await col.deleteOne({ _id: phoneKey, codeHash: doc.codeHash });
  return del.deletedCount === 1 ? 'ok' : 'expired';
}

module.exports = { OTP_TTL_MS, OTP_MAX_ATTEMPTS, ensureIndexes, issue, verify, generateCode, hashCode };
