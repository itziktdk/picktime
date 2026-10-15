'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createSender, toLocalIL, sms4freeBalance } = require('../lib/otp-sender');
const KEY = 'key_SECRET_abc';
const PASS = 'pass_SECRET_xyz';
const USER = '0546666094';
function mock(resp, httpStatus = 200) {
  const calls = [];
  const f = async (url, opt) => {
    calls.push({ url, body: JSON.parse(opt.body) });
    const text = typeof resp === 'string' ? resp : JSON.stringify(resp);
    return { status: httpStatus, text: async () => text };
  };
  f.calls = calls;
  return f;
}
const envBase = { SMS4FREE_API_KEY: KEY, SMS4FREE_USER: USER, SMS4FREE_PASS: PASS };

test('auto-selects sms4free when creds present and no micropay', () => {
  const s = createSender(envBase);
  assert.strictEqual(s.name, 'sms4free-sms');
  assert.strictEqual(s.configured, true);
  assert.strictEqual(createSender({ OTP_PROVIDER: 'sms4free-sms' }).configured, false);
});

test('micropay still wins auto-select over sms4free', () => {
  const s = createSender({ ...envBase, MICROPAY_API_TOKEN: 'tok' });
  assert.strictEqual(s.name, 'micropay-sms');
});

test('send posts v2 SendSMS with local IL phone and never leaks secrets', async () => {
  const f = mock({ status: 1, message: 'ok' });
  const r = await createSender({ ...envBase, __fetch: f }).send('+972546666094', '123456', { lang: 'he' });
  assert.strictEqual(r.id, 'sms4free');
  assert.strictEqual(r.status, 1);
  const { url, body } = f.calls[0];
  assert.strictEqual(url, 'https://api.sms4free.co.il/ApiSMS/v2/SendSMS');
  assert.deepStrictEqual([body.recipient, body.user, body.sender, body.key], [USER, USER, USER, KEY]);
  assert.match(body.msg, /123456/);
  assert.match(body.msg, /Snaptor/);
});

test('custom sender; bare integer success still works', async () => {
  const f = mock('2');
  await createSender({ ...envBase, SMS4FREE_SENDER: 'Snaptor', __fetch: f }).send('0501234567', '999888', { lang: 'en' });
  assert.strictEqual(f.calls[0].body.sender, 'Snaptor');
  assert.match(f.calls[0].body.msg, /999888/);
});

test('errors map status and never leak secrets', async () => {
  for (const [status, http] of [[-4, 429], [-6, 403], [-1, 502]]) {
    const f = mock({ status, message: 'x' });
    await assert.rejects(
      createSender({ ...envBase, __fetch: f }).send('0501234567', '1'),
      (e) => {
        assert.strictEqual(e.status, http);
        assert.ok(!e.message.includes(KEY));
        assert.ok(!e.message.includes(PASS));
        assert.ok(!JSON.stringify(e.provider).includes(KEY));
        return true;
      }
    );
  }
});

test('balance check (integer or object)', async () => {
  const f = mock('42');
  const b = await sms4freeBalance(envBase, f);
  assert.deepStrictEqual([b.ok, b.credit], [true, 42]);
  assert.strictEqual(f.calls[0].url, 'https://api.sms4free.co.il/ApiSMS/AvailableSMS');
  const b2 = await sms4freeBalance(envBase, mock({ status: -1, message: 'bad' }));
  assert.strictEqual(b2.ok, false);
});

test('toLocalIL still normalises for sms4free path', () => {
  assert.strictEqual(toLocalIL('+972546666094'), '0546666094');
});
