/**
 * Snaptor Reminder Service
 * Sends SMS/WhatsApp appointment reminders via Twilio
 * 
 * Supports:
 * - SMS via Twilio
 * - WhatsApp via Twilio WhatsApp API
 * - Fallback: WhatsApp first, SMS if WhatsApp fails
 * 
 * Environment variables:
 *   TWILIO_ACCOUNT_SID   - Twilio Account SID
 *   TWILIO_AUTH_TOKEN     - Twilio Auth Token
 *   TWILIO_PHONE_NUMBER   - Twilio phone number for SMS (e.g. +972...)
 *   TWILIO_WHATSAPP_NUMBER - Twilio WhatsApp sender (e.g. +14155238886)
 *   REMINDER_CHANNEL      - 'sms' | 'whatsapp' | 'both' (default: 'both')
 *   REMINDER_API_URL      - Snaptor API base URL (default: http://localhost:3000)
 *   REMINDER_API_KEY       - Optional API key for /api/reminders/* endpoints
 */

const REMINDER_API_URL = process.env.REMINDER_API_URL || 'http://localhost:3000';
const REMINDER_CHANNEL = process.env.REMINDER_CHANNEL || 'both';

let twilioClient = null;

function initTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.warn('[Reminder] Twilio credentials not configured — reminders will be logged only');
    return null;
  }
  try {
    const twilio = require('twilio');
    twilioClient = twilio(sid, token);
    console.log('[Reminder] Twilio client initialized');
    return twilioClient;
  } catch (err) {
    console.error('[Reminder] Failed to initialize Twilio:', err.message);
    return null;
  }
}

/**
 * Normalize Israeli phone number to E.164 format
 */
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('0')) cleaned = '+972' + cleaned.slice(1);
  else if (cleaned.startsWith('972')) cleaned = '+' + cleaned;
  else if (!cleaned.startsWith('+')) cleaned = '+972' + cleaned;
  return cleaned;
}

/**
 * Send SMS via Twilio
 */
async function sendSMS(to, message) {
  if (!twilioClient) {
    console.log(`[Reminder][DRY-RUN] SMS to ${to}: ${message.slice(0, 80)}...`);
    return { success: true, dry: true, sid: 'dry-run' };
  }

  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!fromNumber) throw new Error('TWILIO_PHONE_NUMBER not configured');

  const result = await twilioClient.messages.create({
    body: message,
    from: fromNumber,
    to: normalizePhone(to),
  });

  console.log(`[Reminder] SMS sent to ${to} — SID: ${result.sid}`);
  return { success: true, sid: result.sid, channel: 'sms' };
}

/**
 * Send WhatsApp message via Twilio
 */
async function sendWhatsApp(to, message) {
  if (!twilioClient) {
    console.log(`[Reminder][DRY-RUN] WhatsApp to ${to}: ${message.slice(0, 80)}...`);
    return { success: true, dry: true, sid: 'dry-run' };
  }

  const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886';

  const result = await twilioClient.messages.create({
    body: message,
    from: `whatsapp:${whatsappNumber}`,
    to: `whatsapp:${normalizePhone(to)}`,
  });

  console.log(`[Reminder] WhatsApp sent to ${to} — SID: ${result.sid}`);
  return { success: true, sid: result.sid, channel: 'whatsapp' };
}

/**
 * Send a reminder using the configured channel strategy
 */
async function sendReminder(to, message, channel = REMINDER_CHANNEL) {
  const phone = normalizePhone(to);
  if (!phone) return { success: false, error: 'Invalid phone number' };

  try {
    if (channel === 'whatsapp') {
      return await sendWhatsApp(phone, message);
    }
    if (channel === 'sms') {
      return await sendSMS(phone, message);
    }
    // 'both' — try WhatsApp first, fallback to SMS
    try {
      return await sendWhatsApp(phone, message);
    } catch (waErr) {
      console.warn(`[Reminder] WhatsApp failed for ${phone}, falling back to SMS:`, waErr.message);
      return await sendSMS(phone, message);
    }
  } catch (err) {
    console.error(`[Reminder] Failed to send to ${phone}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Check for pending reminders and send them
 * This is the main loop function — call it periodically (every 1-5 minutes)
 */
async function processReminders(apiUrl = REMINDER_API_URL) {
  try {
    // 1. Check for pending reminders
    const checkRes = await fetch(`${apiUrl}/api/reminders/check`, { method: 'POST' });
    if (!checkRes.ok) {
      console.error(`[Reminder] Check failed: ${checkRes.status}`);
      return { sent: 0, failed: 0 };
    }

    const { reminders } = await checkRes.json();
    if (!reminders || reminders.length === 0) return { sent: 0, failed: 0 };

    console.log(`[Reminder] ${reminders.length} reminder(s) to send`);

    let sent = 0, failed = 0;

    // 2. Send each reminder
    for (const reminder of reminders) {
      const result = await sendReminder(reminder.customerPhone, reminder.message);

      if (result.success) {
        // 3. Mark as sent
        await fetch(`${apiUrl}/api/reminders/mark-sent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentId: reminder.appointmentId,
            intervalKey: reminder.intervalKey,
          }),
        });
        sent++;
      } else {
        failed++;
      }

      // Small delay between messages to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Reminder] Done: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  } catch (err) {
    console.error('[Reminder] Process error:', err.message);
    return { sent: 0, failed: 0, error: err.message };
  }
}

/**
 * Start the reminder loop (runs every intervalMs)
 */
function startReminderLoop(intervalMs = 60000, apiUrl = REMINDER_API_URL) {
  initTwilio();
  console.log(`[Reminder] Starting loop (every ${intervalMs / 1000}s)`);

  // Run immediately
  processReminders(apiUrl);

  // Then on interval
  const timer = setInterval(() => processReminders(apiUrl), intervalMs);
  return timer;
}

module.exports = {
  initTwilio,
  normalizePhone,
  sendSMS,
  sendWhatsApp,
  sendReminder,
  processReminders,
  startReminderLoop,
};
