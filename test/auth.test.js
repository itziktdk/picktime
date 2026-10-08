'use strict';
// C-3: login hardening (legacy mode) and OTP login (flag on/off), sessions, admin.
const { test, before, after, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, createBusiness } = require('./helpers');
const { createSender } = require('../lib/otp-sender');

let ctx;
before(async () => { ctx = await setup({ PHONE_LOGIN_LIMIT: '5', OTP_SEND_PER_PHONE_15M: '3' }); });
after(async () => { await ctx.teardown(); });
beforeEach(async () => {
  delete process.env.AUTH_OTP_REQUIRED;
  ctx.srv.setOtpSender(createSender({ OTP_PROVIDER: 'none' }));
  await ctx.db.collection('rate_limits').deleteMany({});
});

function enableOtp() {
  const sender = createSender({ OTP_PROVIDER: 'console', NODE_ENV: 'test' });
  ctx.srv.setOtpSender(sender);
  process.env.AUTH_OTP_REQUIRED = 'true';
  return sender;
}

describe('legacy login (AUTH_OTP_REQUIRED off)', () => {
  test('returns a 7-day token and normalized business', async () => {
    const phone = '0500000961';
    const { slug } = await createBusiness(ctx.api, { phone });
    const r = await ctx.api.post('/api/auth/login').send({ phone: '050-000-0961' });
    assert.equal(r.status, 200);
    assert.equal(r.body.exists, true);
    assert.equal(r.body.otpRequired, false);
    assert.equal(r.body.business.slug, slug);
    const d = jwt.decode(r.body.token);
    assert.ok(d.exp - d.iat <= 7 * 24 * 3600, 'token lifetime ≤ 7 days');
    assert.ok(d.exp - d.iat > 6 * 24 * 3600);
  });

  test('per-phone rate limit kicks in (independent of IP)', async () => {
    const phone = '0500000962';
    await createBusiness(ctx.api, { phone });
    for (let i = 0; i < 5; i++) assert.equal((await ctx.api.post('/api/auth/login').send({ phone })).status, 200);
    const r = await ctx.api.post('/api/auth/login').send({ phone: '+972500000962' });
    assert.equal(r.status, 429);
  });

  test('operator injection in phone is neutralised', async () => {
    const r = await ctx.api.post('/api/auth/login').send({ phone: { $ne: null } });
    assert.equal(r.status, 400);
  });

  test('flag on but no provider configured → stays in legacy mode (no lockout)', async () => {
    process.env.AUTH_OTP_REQUIRED = 'true';
    const phone = '0500000963';
    await createBusiness(ctx.api, { phone });
    const r = await ctx.api.post('/api/auth/login').send({ phone });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal((await ctx.api.post('/api/auth/verify-otp').send({ phone, code: '123456' })).status, 400);
  });
});

describe('OTP login (AUTH_OTP_REQUIRED=true + provider)', () => {
  test('login sends a code and returns no token/business; verify returns the session', async () => {
    const sender = enableOtp();
    const phone = '0500000964';
    const { slug } = await createBusiness(ctx.api, { phone });
    const r = await ctx.api.post('/api/auth/login').send({ phone, slug });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['expiresIn', 'otpRequired', 'sent']);
    assert.equal(r.body.expiresIn, 300);
    const code = sender.sent.at(-1).code;
    assert.match(code, /^\d{6}$/);
    const stored = await ctx.db.collection('otp_codes').findOne({ _id: phone });
    assert.ok(stored && stored.codeHash && !JSON.stringify(stored).includes(code), 'code stored hashed only');
    const v = await ctx.api.post('/api/auth/verify-otp').send({ phone, code });
    assert.equal(v.status, 200);
    assert.equal(v.body.business.slug, slug);
    assert.ok(v.body.token);
    const reuse = await ctx.api.post('/api/auth/verify-otp').send({ phone, code });
    assert.equal(reuse.status, 400, 'single use');
  });

  test('unknown phone gets the same response (no enumeration); verify then says exists:false', async () => {
    const sender = enableOtp();
    const r = await ctx.api.post('/api/auth/login').send({ phone: '0500000965' });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['expiresIn', 'otpRequired', 'sent']);
    const v = await ctx.api.post('/api/auth/verify-otp').send({ phone: '0500000965', code: sender.sent.at(-1).code });
    assert.deepEqual(v.body, { exists: false, phoneVerified: true });
  });

  test('wrong codes: 5 attempts then locked; legacy slug-only login no longer issues tokens', async () => {
    const sender = enableOtp();
    const phone = '0500000966';
    const { slug } = await createBusiness(ctx.api, { phone });
    await ctx.api.post('/api/auth/login').send({ phone });
    const good = sender.sent.at(-1).code;
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const r = await ctx.api.post('/api/auth/verify-otp').send({ phone, code: wrong });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'otp_invalid');
    }
    const locked = await ctx.api.post('/api/auth/verify-otp').send({ phone, code: wrong });
    assert.equal(locked.status, 429);
    const after = await ctx.api.post('/api/auth/verify-otp').send({ phone, code: good });
    assert.equal(after.status, 400, 'code is burned after lockout');
    const legacy = await ctx.api.post('/api/auth/login').send({ phone, slug });
    assert.equal(legacy.body.token, undefined);
  });

  test('expired code is rejected', async () => {
    const sender = enableOtp();
    const phone = '0500000967';
    await createBusiness(ctx.api, { phone });
    await ctx.api.post('/api/auth/login').send({ phone });
    await ctx.db.collection('otp_codes').updateOne({ _id: phone }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await ctx.api.post('/api/auth/verify-otp').send({ phone, code: sender.sent.at(-1).code });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'otp_expired');
  });

  test('send rate limit per phone', async () => {
    enableOtp();
    const phone = '0500000968';
    for (let i = 0; i < 3; i++) assert.equal((await ctx.api.post('/api/auth/login').send({ phone })).status, 200);
    assert.equal((await ctx.api.post('/api/auth/login').send({ phone })).status, 429);
  });

  test('multi-business phone: verify returns list + loginTicket, ticket selects a business', async () => {
    const sender = enableOtp();
    const phone = '0500000969';
    const b1 = await createBusiness(ctx.api, { phone });
    const b2 = await createBusiness(ctx.api, { phone });
    await ctx.api.post('/api/auth/login').send({ phone });
    const v = await ctx.api.post('/api/auth/verify-otp').send({ phone, code: sender.sent.at(-1).code });
    assert.equal(v.status, 200);
    assert.equal(v.body.token, undefined);
    assert.equal(v.body.businesses.length, 2);
    assert.ok(v.body.loginTicket);
    const sel = await ctx.api.post('/api/auth/login').send({ phone, slug: b2.slug, loginTicket: v.body.loginTicket });
    assert.equal(sel.status, 200);
    assert.equal(sel.body.business.slug, b2.slug);
    const forged = await ctx.api.post('/api/auth/login').send({ phone: '0500000970', slug: b1.slug, loginTicket: v.body.loginTicket });
    assert.equal(forged.status, 401, 'ticket bound to the verified phone');
  });

  test('console provider refuses to run in production', async () => {
    const s = createSender({ OTP_PROVIDER: 'console', NODE_ENV: 'production' });
    assert.equal(s.configured, false);
  });

  test('twilio-sms provider is configured only with SID, token and sender', () => {
    assert.equal(createSender({ OTP_PROVIDER: 'twilio-sms', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' }).configured, false);
    assert.equal(createSender({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_PHONE_NUMBER: '+15005550006' }).name, 'twilio-sms');
    assert.equal(createSender({ OTP_PROVIDER: 'twilio-whatsapp', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_WHATSAPP_NUMBER: '+14155238886' }).configured, true);
  });
});

describe('sessions', () => {
  test('refresh issues a new token; expired/garbage/alg:none tokens are rejected', async () => {
    const { auth, business } = await createBusiness(ctx.api);
    const r = await ctx.api.post('/api/auth/refresh').set(auth);
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    const expired = jwt.sign({ businessId: business._id, slug: business.slug }, process.env.JWT_SECRET, { expiresIn: -10 });
    assert.equal((await ctx.api.post('/api/auth/refresh').set({ Authorization: `Bearer ${expired}` })).status, 401);
    const none = Buffer.from('{"alg":"none"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ businessId: business._id })).toString('base64url') + '.';
    assert.equal((await ctx.api.get('/api/auth/me').set({ Authorization: `Bearer ${none}` })).status, 401);
    const wrongSecret = jwt.sign({ businessId: business._id, slug: business.slug }, 'snaptor-secret-key-change-in-production');
    assert.equal((await ctx.api.get('/api/auth/me').set({ Authorization: `Bearer ${wrongSecret}` })).status, 401, 'old in-code default secret no longer works');
  });

  test('tokens stop working as soon as the account is deleted', async () => {
    const { auth, slug } = await createBusiness(ctx.api);
    assert.equal((await ctx.api.delete('/api/account').set(auth).send({ confirmSlug: slug })).status, 200);
    assert.equal((await ctx.api.get('/api/auth/me').set(auth)).status, 401);
    assert.equal((await ctx.api.post('/api/push-tokens').set(auth).send({ token: 'ExponentPushToken[abc]' })).status, 401);
  });
});

describe('admin', () => {
  test('admin login needs the configured password; old default is rejected', async () => {
    assert.equal((await ctx.api.post('/api/admin/login').send({ password: 'snaptor2026' })).status, 401);
    const ok = await ctx.api.post('/api/admin/login').send({ password: 'test-admin-password' });
    assert.equal(ok.status, 200);
    assert.equal((await ctx.api.get('/api/admin/data').set({ Authorization: `Bearer ${ok.body.token}` })).status, 200);
    const owner = await createBusiness(ctx.api);
    assert.equal((await ctx.api.get('/api/admin/data').set(owner.auth)).status, 401, 'owner token is not admin');
  });
});
