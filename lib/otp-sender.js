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
//   micropay-sms     Micropay (micropay.co.il) sendOtp.php, type=sms, with our own code (precode) so
//                    server-side verify + rate limits stay. Needs MICROPAY_API_TOKEN; optional
//                    MICROPAY_SENDER (default 'Snaptor'; set to '-' to use account default).
//   sms4free-sms     SMS4Free (sms4free.co.il) ApiSMS/v2/SendSMS with our own code in the body.
//                    Needs SMS4FREE_API_KEY, SMS4FREE_USER (login phone), SMS4FREE_PASS; optional
//                    SMS4FREE_SENDER (default registration phone / 'Snaptor' when a paid package allows it).
//   console          Logs the code to stdout. Refused when NODE_ENV=production. Dev/test only.
//   none             (default) Not configured — OTP cannot be enforced.
// If OTP_PROVIDER is unset and MICROPAY_API_TOKEN exists, micropay-sms is used; else if SMS4FREE_API_KEY+USER+PASS
// exist, sms4free-sms is used; else if Twilio SMS credentials exist, twilio-sms is used.

function toE164(phone) {
  let p = String(phone || '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('972')) return '+' + p;
  if (p.startsWith('0')) return '+972' + p.slice(1);
  return '+972' + p;
}

const MICROPAY_BASE = 'https://www.micropay.co.il/extApi/';

// +972 / 972 / 05X / 5X -> 05XXXXXXXX (digits only)
function toLocalIL(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('972')) p = '0' + p.slice(3);
  else if (!p.startsWith('0')) p = '0' + p;
  return p;
}

const MICROPAY_PREFIX = { he: 'קוד הכניסה שלך ל-Snaptor:', en: 'Your Snaptor login code:', ru: 'Ваш код входа в Snaptor:', ar: 'رمز الدخول إلى Snaptor:' };

// Never include the token in errors/logs.
async function micropayPost(file, payload, fetchImpl = fetch) {
  const res = await fetchImpl(MICROPAY_BASE + file, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (body && body.data) delete body.data.remoteIP;
  return { httpStatus: res.status, body };
}

async function micropayBalance(env = process.env, fetchImpl = fetch) {
  const { httpStatus, body } = await micropayPost('scheduleSms.php', { token: env.MICROPAY_API_TOKEN, act: 'credit' }, fetchImpl);
  const ok = body && Number(body.status) === 1;
  return { ok, httpStatus, credit: ok ? body.data && body.data.credit : undefined, message: body && body.message, description: body && body.data && body.data.description };
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


const SMS4FREE_SEND = 'https://api.sms4free.co.il/ApiSMS/v2/SendSMS';
const SMS4FREE_BALANCE = 'https://api.sms4free.co.il/ApiSMS/AvailableSMS';

const SMS4FREE_ERR = {
  0: 'general error',
  [-1]: 'bad key, user, or password',
  [-2]: 'bad sender',
  [-3]: 'no recipients',
  [-4]: 'low balance',
  [-5]: 'message rejected',
  [-6]: 'sender number needs verification',
};

async function sms4freePost(url, payload, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (typeof body === 'number') {
    body = { status: body, message: SMS4FREE_ERR[body] };
  } else if (!body || typeof body !== 'object') {
    const n = parseInt(text, 10);
    body = Number.isFinite(n) ? { status: n, message: SMS4FREE_ERR[n] || text.slice(0, 200) } : { status: 0, message: String(text).slice(0, 200) };
  }
  return { httpStatus: res.status, body };
}

function sms4freeCreds(env) {
  return {
    key: env.SMS4FREE_API_KEY,
    user: env.SMS4FREE_USER,
    pass: env.SMS4FREE_PASS,
  };
}

async function sms4freeBalance(env = process.env, fetchImpl = fetch) {
  const { httpStatus, body } = await sms4freePost(SMS4FREE_BALANCE, sms4freeCreds(env), fetchImpl);
  const status = body && Number(body.status);
  const ok = Number.isFinite(status) && status >= 0 && httpStatus === 200;
  // AvailableSMS often returns a bare integer (v1); treat non-negative as credit.
  const credit = ok ? status : undefined;
  return { ok, httpStatus, credit, message: body && body.message };
}

function createSender(env = process.env) {
  let provider = (env.OTP_PROVIDER || '').trim().toLowerCase();
  if (!provider && env.MICROPAY_API_TOKEN) provider = 'micropay-sms';
  if (!provider && env.SMS4FREE_API_KEY && env.SMS4FREE_USER && env.SMS4FREE_PASS) provider = 'sms4free-sms';
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
  if (provider === 'micropay-sms') {
    const fetchImpl = env.__fetch || fetch;
    return {
      name: provider,
      configured: !!env.MICROPAY_API_TOKEN,
      async send(phone, code, { lang } = {}) {
        const l = MICROPAY_PREFIX[lang] ? lang : 'he';
        const payload = {
          token: env.MICROPAY_API_TOKEN, phone: toLocalIL(phone), type: 'sms',
          precode: String(code), codelen: String(code).length, smstext: MICROPAY_PREFIX[l], lang: l,
          maxsms: 3, webotp: env.MICROPAY_WEBOTP_DOMAIN || 'snaptor.app',
        };
        const sender = env.MICROPAY_SENDER === undefined ? 'Snaptor' : env.MICROPAY_SENDER;
        if (sender && sender !== '-') payload.smsfrom = sender;
        const { httpStatus, body } = await micropayPost('sendOtp.php', payload, fetchImpl);
        if (body && body.message === 'CODE_SENT') return { id: 'micropay', channel: body.data && body.data.channel, httpStatus };
        const desc = (body && body.data && body.data.description) || (body && (body.message || body.raw)) || 'unknown';
        const err = new Error(`Micropay error ${httpStatus}: ${body && body.message} ${desc}`.trim());
        err.status = body && body.message === 'MAX_SENT' ? 429 : 502;
        err.provider = { httpStatus, message: body && body.message, description: desc };
        throw err;
      },
    };
  }
  if (provider === 'sms4free-sms') {
    const fetchImpl = env.__fetch || fetch;
    const configured = !!(env.SMS4FREE_API_KEY && env.SMS4FREE_USER && env.SMS4FREE_PASS);
    return {
      name: provider,
      configured,
      async send(phone, code, { lang } = {}) {
        const sender = env.SMS4FREE_SENDER === undefined ? (env.SMS4FREE_USER || 'Snaptor') : env.SMS4FREE_SENDER;
        const payload = {
          ...sms4freeCreds(env),
          sender,
          recipient: toLocalIL(phone),
          msg: otpMessage(code, lang),
        };
        const { httpStatus, body } = await sms4freePost(SMS4FREE_SEND, payload, fetchImpl);
        const status = body && Number(body.status);
        if (Number.isFinite(status) && status > 0) return { id: 'sms4free', httpStatus, status };
        const desc = (body && body.message) || SMS4FREE_ERR[status] || 'unknown';
        const err = new Error(`SMS4Free error ${httpStatus}: ${status} ${desc}`.trim());
        err.status = status === -4 ? 429 : status === -6 ? 403 : 502;
        err.provider = { httpStatus, status, message: desc };
        throw err;
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

module.exports = { createSender, toE164, toLocalIL, otpMessage, micropayBalance, sms4freeBalance, MICROPAY_PREFIX };
