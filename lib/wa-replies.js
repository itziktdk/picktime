'use strict';
// Sprint 2: WhatsApp confirm / cancel replies (Twilio WhatsApp webhook). OFF unless
// WHATSAPP_REPLIES_ENABLED=true AND Twilio credentials + an approved WhatsApp sender are set.
const crypto = require('crypto');

function isEnabled(env = process.env) {
  return env.WHATSAPP_REPLIES_ENABLED === 'true' && !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN && !!env.TWILIO_WHATSAPP_NUMBER;
}

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)). */
function twilioSignature(authToken, url, params) {
  const data = Object.keys(params || {}).sort().reduce((acc, k) => acc + k + (params[k] ?? ''), url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}
function validSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const a = Buffer.from(twilioSignature(authToken, url, params)), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const CONFIRM = ['1', 'כן', 'אישור', 'מאשר', 'מאשרת', 'מגיע', 'מגיעה', 'yes', 'y', 'ok', 'confirm', 'да', 'подтверждаю'];
const CANCEL = ['2', 'ביטול', 'לבטל', 'בטל', 'מבטל', 'מבטלת', 'no', 'cancel', 'нет', 'отмена', 'отменить'];
/** 'confirm' | 'cancel' | null from a free-text reply (first word, punctuation/emoji stripped). */
function parseReply(body) {
  const w = String(body || '').trim().toLowerCase().replace(/[.!,?\u200f\u200e]/g, ' ').split(/\s+/)[0] || '';
  if (CONFIRM.includes(w) || w === '👍' || w === '✅') return 'confirm';
  if (CANCEL.includes(w) || w === '❌') return 'cancel';
  return null;
}

const HINT = { he: 'לאישור השיבו 1, לביטול השיבו 2.', en: 'Reply 1 to confirm, 2 to cancel.' };
const REPLIES = {
  confirmed: 'תודה! התור אושר ✅ / Thanks, your booking is confirmed.',
  cancelled: 'התור בוטל. נשמח לראותכם בפעם אחרת. / Your booking was cancelled.',
  cannot_cancel: 'לא ניתן לבטל את התור בהודעה – נא ליצור קשר עם העסק. / This booking can no longer be cancelled by message; please contact the business.',
  not_found: 'לא מצאנו תור קרוב למספר הזה. / We could not find an upcoming booking for this number.',
  unknown: 'לאישור השיבו 1, לביטול השיבו 2. / Reply 1 to confirm, 2 to cancel.',
};
const twiml = (msg) => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message></Response>`;

module.exports = { isEnabled, twilioSignature, validSignature, parseReply, HINT, REPLIES, twiml };
