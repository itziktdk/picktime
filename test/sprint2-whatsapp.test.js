'use strict';
// Sprint 2: WhatsApp confirm/cancel replies — flag off → 404; signature required; 1 confirms, 2 cancels.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, daysFromToday } = require('./helpers');
const wa = require('../lib/wa-replies');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); for (const k of ['WHATSAPP_REPLIES_ENABLED', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_NUMBER']) delete process.env[k]; });
const BASE = process.env.PUBLIC_BASE_URL || 'https://snaptor.app';
const post = (params, sig) => ctx.api.post('/api/webhooks/whatsapp').type('form').set('X-Twilio-Signature', sig ?? wa.twilioSignature('tok', `${BASE}/api/webhooks/whatsapp`, params)).send(params);

describe('S2 WhatsApp replies', () => {
  test('parseReply', () => {
    for (const s of ['1', 'כן', 'אישור!', 'Yes', '👍', 'да']) assert.equal(wa.parseReply(s), 'confirm', s);
    for (const s of ['2', 'ביטול', 'Cancel please', 'нет']) assert.equal(wa.parseReply(s), 'cancel', s);
    for (const s of ['', 'hello', '3']) assert.equal(wa.parseReply(s), null, s);
  });
  test('flag off → 404; on: bad signature 403, confirm + cancel', async () => {
    const b = await createBusiness(ctx.api);
    const svc = String(b.business.services[0]._id);
    const mk = async (d, t) => (await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: 'QA WA', customerPhone: '0500000988', serviceId: svc, date: d, startTime: t })).body.id;
    const a1 = await mk(daysFromToday(1), '10:00');
    const a2 = await mk(daysFromToday(2), '10:00');
    const { ObjectId } = require('mongodb');
    await ctx.db.collection('appointments').updateMany({ _id: { $in: [new ObjectId(a1), new ObjectId(a2)] } }, { $set: { waReplyAsked: true } });
    const params = { From: 'whatsapp:+972500000988', Body: '1' };
    assert.equal((await post(params)).status, 404);
    Object.assign(process.env, { WHATSAPP_REPLIES_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_NUMBER: '+14155238886' });
    assert.equal((await post(params, 'bad')).status, 403);
    let r = await post(params);
    assert.equal(r.status, 200); assert.match(r.text, /<Response><Message>/); assert.match(r.text, /confirmed/);
    const get = async (id) => (await ctx.api.get(`/api/businesses/${b.slug}/appointments`).set(b.auth)).body.find(x => x.id === id);
    assert.equal((await get(a1)).status, 'confirmed');
    assert.equal((await get(a2)).status, 'pending'); // only the soonest
    r = await post({ From: 'whatsapp:+972500000988', Body: 'ביטול' });
    assert.match(r.text, /cancelled/);
    assert.equal((await get(a1)).status, 'cancelled');
    r = await post({ From: 'whatsapp:+972500000977', Body: '1' });
    assert.match(r.text, /could not find/);
    r = await post({ From: 'whatsapp:+972500000988', Body: 'hi' });
    assert.match(r.text, /Reply 1/);
  });
});
