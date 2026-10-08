'use strict';
// Pluggable one-time-code sender.
//
// OTP_PROVIDER selects the channel:
//   twilio-sms       Twilio Programmable SMS. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
//                    TWILIO_PHONE_NUMBER (E.164 sender) or TWILIO_MESSAGING_SERVICE_SID.
//   twilio-whatsapp  Twilio WhatsApp. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
//                    TWILIO_WHATSAPP_NUMBER (approved WhatsApp sender, E.164). Production
//                    WhatsApp also needs an approved authentication template (TWILIO_WHATSAPP_CONTENT_SID,
//                    optional; when set the code is passed as content variable {{1}}).
//   console          Logs the code to stdout. Refused when NODE_ENV=production. Dev/test only.
//   none             (default) Not configured — OTP cannot be enforced.
// If OTP_PROVIDER is unset but Twilio SMS credentials exist, twilio-sms is used.

function toE164(phone) {
  let p = String(phone || '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('972')) return '+' + p;
  if (p.startsWith('0')) return '+972' + p.slice(1);
  return '+972' + p;
}

function otpMessage(code, lang) {
  if (lang === 'en') return `Your Snaptor login code: ${code}. Valid for 5 minutes. Do not share it.`;
  return `קוד הכניסה שלך ל-Snaptor: ${code}. בתוקף ל-5 דקות. אין למסור אותו לאף אחד.`;
}

async function twilioSend(env, params) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Twilio error ${res.status}: ${body.message || 'unknown'}`);
    err.status = res.status;
    throw err;
  }
  return { id: body.sid };
}

function createSender(env = process.env) {
  let provider = (env.OTP_PROVIDER || '').trim().toLowerCase();
  if (!provider) provider = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_PHONE_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID) ? 'twilio-sms' : 'none';

  const hasTwilio = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);

  if (provider === 'twilio-sms') {
    const configured = hasTwilio && !!(env.TWILIO_PHONE_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID);
    return {
      name: provider,
      configured,
      async send(phone, code, { lang } = {}) {
        const params = { To: toE164(phone), Body: otpMessage(code, lang) };
        if (env.TWILIO_MESSAGING_SERVICE_SID) params.MessagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
        else params.From = env.TWILIO_PHONE_NUMBER;
        return twilioSend(env, params);
      },
    };
  }
  if (provider === 'twilio-whatsapp') {
    const configured = hasTwilio && !!env.TWILIO_WHATSAPP_NUMBER;
    return {
      name: provider,
      configured,
      async send(phone, code, { lang } = {}) {
        const params = { To: `whatsapp:${toE164(phone)}`, From: `whatsapp:${toE164(env.TWILIO_WHATSAPP_NUMBER)}` };
        if (env.TWILIO_WHATSAPP_CONTENT_SID) {
          params.ContentSid = env.TWILIO_WHATSAPP_CONTENT_SID;
          params.ContentVariables = JSON.stringify({ 1: code });
        } else {
          params.Body = otpMessage(code, lang);
        }
        return twilioSend(env, params);
      },
    };
  }
  if (provider === 'console') {
    const allowed = env.NODE_ENV !== 'production';
    return {
      name: provider,
      configured: allowed,
      sent: [],
      async send(phone, code) {
        if (!allowed) throw new Error('console OTP provider is not allowed in production');
        this.sent.push({ phone, code, at: Date.now() });
        console.log(`[otp][console] code for ${phone}: ${code}`);
        return { id: 'console' };
      },
    };
  }
  return { name: 'none', configured: false, async send() { throw new Error('No OTP provider configured'); } };
}

module.exports = { createSender, toE164, otpMessage };
