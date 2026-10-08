/**
 * Snaptor Reminder Service — sends customer SMS/WhatsApp reminders via the Twilio REST API.
 *
 * Environment variables:
 *   TWILIO_ACCOUNT_SID     - Twilio Account SID
 *   TWILIO_AUTH_TOKEN      - Twilio Auth Token
 *   TWILIO_PHONE_NUMBER    - Twilio SMS sender (E.164, e.g. +972...) or
 *   TWILIO_MESSAGING_SERVICE_SID - Twilio Messaging Service SID (alternative to a number)
 *   TWILIO_WHATSAPP_NUMBER - Approved Twilio WhatsApp sender (E.164)
 *   REMINDER_CHANNEL       - 'sms' | 'whatsapp' | 'both' (default: 'both' = WhatsApp then SMS fallback)
 *
 * Without credentials every send is a logged dry run and isConfigured() is false.
 * Scheduling lives in lib/reminders.js (in-process scheduler + /api/reminders/check for the external cron).
 */

const { toE164 } = require('./lib/otp-sender');

const REMINDER_CHANNEL = process.env.REMINDER_CHANNEL || 'both';

function isConfigured() {
  const e = process.env;
  if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN) return false;
  return !!(e.TWILIO_WHATSAPP_NUMBER || e.TWILIO_PHONE_NUMBER || e.TWILIO_MESSAGING_SERVICE_SID);
}

function normalizePhone(phone) {
  if (!phone) return null;
  return toE164(phone);
}

function mask(phone) {
  const p = String(phone || '');
  return p.length > 4 ? p.slice(0, 4) + '***' + p.slice(-2) : '***';
}

async function twilioMessage(params) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message || 'error'}`);
  return body.sid;
}

async function sendSMS(to, message) {
  if (!isConfigured()) {
    console.log(`[Reminder][DRY-RUN] SMS to ${mask(to)}`);
    return { success: true, dry: true, sid: 'dry-run' };
  }
  const params = { To: normalizePhone(to), Body: message };
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.MessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  else if (process.env.TWILIO_PHONE_NUMBER) params.From = process.env.TWILIO_PHONE_NUMBER;
  else throw new Error('No SMS sender configured');
  const sid = await twilioMessage(params);
  return { success: true, sid, channel: 'sms' };
}

async function sendWhatsApp(to, message) {
  if (!isConfigured()) {
    console.log(`[Reminder][DRY-RUN] WhatsApp to ${mask(to)}`);
    return { success: true, dry: true, sid: 'dry-run' };
  }
  if (!process.env.TWILIO_WHATSAPP_NUMBER) throw new Error('No WhatsApp sender configured');
  const sid = await twilioMessage({
    To: `whatsapp:${normalizePhone(to)}`,
    From: `whatsapp:${normalizePhone(process.env.TWILIO_WHATSAPP_NUMBER)}`,
    Body: message,
  });
  return { success: true, sid, channel: 'whatsapp' };
}

async function sendReminder(to, message, channel = REMINDER_CHANNEL) {
  const phone = normalizePhone(to);
  if (!phone) return { success: false, error: 'Invalid phone number' };
  try {
    if (channel === 'whatsapp') return await sendWhatsApp(phone, message);
    if (channel === 'sms') return await sendSMS(phone, message);
    try {
      return await sendWhatsApp(phone, message);
    } catch (waErr) {
      console.warn(`[Reminder] WhatsApp failed for ${mask(phone)}, falling back to SMS:`, waErr.message);
      return await sendSMS(phone, message);
    }
  } catch (err) {
    console.error(`[Reminder] Failed to send to ${mask(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { isConfigured, normalizePhone, sendSMS, sendWhatsApp, sendReminder };
