'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createSender, toLocalIL, micropayBalance, MICROPAY_PREFIX } = require('../lib/otp-sender');
const TOK = 'tok_SECRET_123';
function mock(resp) { const calls = []; const f = async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body) }); return { status: 200, text: async () => JSON.stringify(resp) }; }; f.calls = calls; return f; }

test('toLocalIL normalises', () => {
  for (const p of ['+972546666094', '972546666094', '0546666094', '546666094', '054-666-6094', '+972 54 666 6094']) assert.strictEqual(toLocalIL(p), '0546666094');
});
test('auto-selects micropay when token present', () => {
  const s = createSender({ MICROPAY_API_TOKEN: TOK });
  assert.strictEqual(s.name, 'micropay-sms'); assert.strictEqual(s.configured, true);
  assert.strictEqual(createSender({ OTP_PROVIDER: 'micropay-sms' }).configured, false);
});
test('send posts sendOtp with precode, sender, hebrew text <=70', async () => {
  const f = mock({ status: 1, message: 'CODE_SENT', data: { channel: 'sms', remoteIP: '1.2.3.4' } });
  const r = await createSender({ MICROPAY_API_TOKEN: TOK, __fetch: f }).send('+972546666094', '123456', { lang: 'he' });
  assert.strictEqual(r.channel, 'sms');
  const { url, body } = f.calls[0];
  assert.match(url, /^https:\/\/www\.micropay\.co\.il\/extApi\/sendOtp\.php$/);
  assert.deepStrictEqual([body.phone, body.type, body.precode, body.codelen, body.smsfrom, body.lang], ['0546666094', 'sms', '123456', 6, 'Snaptor', 'he']);
  assert.ok(`${MICROPAY_PREFIX.he} 123456`.length <= 70);
});
test('sender "-" omits smsfrom; unknown lang -> he', async () => {
  const f = mock({ status: 1, message: 'CODE_SENT', data: {} });
  await createSender({ MICROPAY_API_TOKEN: TOK, MICROPAY_SENDER: '-', __fetch: f }).send('0501234567', '000111', { lang: 'xx' });
  assert.strictEqual(f.calls[0].body.smsfrom, undefined); assert.strictEqual(f.calls[0].body.lang, 'he');
});
test('errors map status and never leak token', async () => {
  for (const [msg, st] of [['MAX_SENT', 429], ['ERROR', 502]]) {
    const f = mock({ status: 0, message: msg, data: { description: 'sender not approved' } });
    await assert.rejects(createSender({ MICROPAY_API_TOKEN: TOK, __fetch: f }).send('0501234567', '1'), (e) => { assert.strictEqual(e.status, st); assert.ok(!e.message.includes(TOK)); assert.ok(!JSON.stringify(e.provider).includes(TOK)); return true; });
  }
});
test('balance check', async () => {
  const f = mock({ status: 1, action: 'credit', message: 'OK', data: { credit: 42 } });
  const b = await micropayBalance({ MICROPAY_API_TOKEN: TOK }, f);
  assert.deepStrictEqual([b.ok, b.credit], [true, 42]); assert.strictEqual(f.calls[0].body.act, 'credit');
  const b2 = await micropayBalance({ MICROPAY_API_TOKEN: TOK }, mock({ status: 0, message: 'ERROR', data: { description: 'bad token' } }));
  assert.deepStrictEqual([b2.ok, b2.description], [false, 'bad token']);
});
