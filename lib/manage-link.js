'use strict';
// Customer "manage booking" links (H-5).
// Token = <24-hex appointment id><32-char HMAC>. The HMAC covers the id and a random
// per-appointment nonce stored on the appointment (manageNonce), so a link can be
// re-generated (reminders, re-sharing) and revoked (rotate the nonce) without storing it.
const crypto = require('crypto');

const SIG_LEN = 32;

function deriveSecret(env, jwtSecret) {
  if (env.MANAGE_LINK_SECRET) return env.MANAGE_LINK_SECRET;
  return crypto.createHmac('sha256', String(jwtSecret)).update('snaptor-manage-link-v1').digest('hex');
}

function newNonce() { return crypto.randomBytes(12).toString('base64url'); }

function sign(secret, apptId, nonce) {
  return crypto.createHmac('sha256', secret).update(`${apptId}.${nonce}`).digest('base64url').slice(0, SIG_LEN);
}

function makeToken(secret, apptId, nonce) {
  return `${String(apptId)}${sign(secret, String(apptId), nonce)}`;
}

/** Split a token into { id, sig } or null if malformed. */
function parse(token) {
  if (typeof token !== 'string') return null;
  const m = token.match(/^([a-f0-9]{24})([A-Za-z0-9_-]{32})$/);
  return m ? { id: m[1], sig: m[2] } : null;
}

function verify(secret, appt, sig) {
  if (!appt || !appt.manageNonce || typeof sig !== 'string') return false;
  const expected = Buffer.from(sign(secret, appt._id.toString(), appt.manageNonce));
  const got = Buffer.from(sig);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

function manageUrl(baseUrl, slug, token) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${encodeURIComponent(slug)}/manage/${token}`;
}

module.exports = { deriveSecret, newNonce, sign, makeToken, parse, verify, manageUrl, SIG_LEN };
