'use strict';
const { decodeEntities } = require('./text');
// Appointment reminders: due-reminder computation (time-zone aware, window based)
// plus an in-process scheduler guarded by a MongoDB lock so only one instance runs a tick.
const crypto = require('crypto');
const { businessTz, nowInTz, addDays, zonedTimeToUtcMs, isValidYMD, isValidHM } = require('./time');

const INTERVALS = [
  { minutes: 1440, key: '1day' },
  { minutes: 120, key: '2hours' },
  { minutes: 60, key: '1hour' },
  { minutes: 30, key: '30min' },
];
const PUSH_KEYS = new Set(['1day', '1hour']); // owner push reminders always on
const VALID_KEYS = new Set(INTERVALS.map(i => i.key));
const DEFAULT_SETTINGS = { '1day': true, '2hours': true, '30min': false };
// A reminder is due when the appointment starts within (interval - GRACE, interval] minutes from now.
// A window (instead of exact-minute matching) means a missed scheduler tick doesn't skip it.
const GRACE_MIN = 15;
// H-5: the reminder carries the customer's manage link (cancel / reschedule) instead of the
// old "reply 1/2" instruction, which nothing on the server ever handled.
const DEFAULT_TEMPLATE = 'שלום {customer_name}, תזכורת: יש לך תור ל{service} ב{date} בשעה {time} ב{business_name}.\nלביטול או שינוי מועד: {manage_link}';
const LEGACY_REPLY_HINT = /\s*לאישור השב 1, לביטול השב 2\.?/;

let manageUrlBuilder = null; // (biz, appt) => Promise<string>; injected by server.js
function setManageUrlBuilder(fn) { manageUrlBuilder = typeof fn === 'function' ? fn : null; }

function renderTemplate(template, appt, biz, manageUrl = '') {
  let t = (template || DEFAULT_TEMPLATE).replace(LEGACY_REPLY_HINT, '');
  if (manageUrl && !t.includes('{manage_link}')) t += '\n{manage_link}';
  if (!manageUrl) t = t.replace(/\n?[^\n]*{manage_link}[^\n]*/g, '');
  // Legacy records may hold HTML entities (M-2); messages are plain text. Function replacers so
  // "$&"-style sequences in names are taken literally.
  const v = (x) => () => decodeEntities(x || '');
  return decodeEntities(t)
    .replace(/{customer_name}/g, v(appt.customerName))
    .replace(/{service}/g, v(appt.serviceName))
    .replace(/{date}/g, v(appt.date))
    .replace(/{time}/g, v(appt.startTime))
    .replace(/{business_name}/g, v(biz.name))
    .replace(/{manage_link}/g, () => manageUrl || '');
}

/** List due reminders. Each item: { appt, biz, key, wantsWhatsApp, wantsPush, message } */
async function findDue(db, nowMs = Date.now()) {
  const businesses = await db.collection('businesses')
    .find({ isActive: { $ne: false } }, { projection: { name: 1, slug: 1, reminderSettings: 1, timezone: 1 } })
    .toArray();
  if (!businesses.length) return [];
  const byId = new Map(businesses.map(b => [b._id.toString(), b]));
  const dates = new Set();
  for (const b of businesses) {
    const today = nowInTz(businessTz(b), nowMs).date;
    for (let i = -1; i <= 2; i++) dates.add(addDays(today, i));
  }
  const appts = await db.collection('appointments')
    .find({ date: { $in: [...dates] }, status: { $in: ['confirmed', 'pending'] } })
    .toArray();

  const due = [];
  for (const appt of appts) {
    const biz = byId.get(String(appt.businessId));
    if (!biz || !isValidYMD(appt.date) || !isValidHM(appt.startTime)) continue;
    const startMs = zonedTimeToUtcMs(appt.date, appt.startTime, businessTz(biz));
    const minutesUntil = (startMs - nowMs) / 60000;
    if (minutesUntil <= 0) continue;
    const settings = biz.reminderSettings || DEFAULT_SETTINGS;
    for (const iv of INTERVALS) {
      if (!(minutesUntil <= iv.minutes && minutesUntil > iv.minutes - GRACE_MIN)) continue;
      const wantsWhatsApp = !!settings[iv.key] && !(appt.reminders && appt.reminders[iv.key] === true);
      const wantsPush = PUSH_KEYS.has(iv.key) && !(appt.pushReminders && appt.pushReminders[iv.key] === true);
      if (!wantsWhatsApp && !wantsPush) continue;
      due.push({ appt, biz, key: iv.key, wantsWhatsApp, wantsPush, template: settings.template, message: renderTemplate(settings.template, appt, biz) });
    }
  }
  if (manageUrlBuilder) {
    for (const d of due) {
      if (!d.wantsWhatsApp) continue;
      try {
        const url = await manageUrlBuilder(d.biz, d.appt);
        if (url) d.message = renderTemplate(d.template, d.appt, d.biz, url);
      } catch (err) { console.error('[reminders] manage link error', err && err.message); }
    }
  }
  return due;
}

/** Atomically claim a flag on an appointment; true if this caller won. */
async function claim(db, apptId, field) {
  const r = await db.collection('appointments').updateOne({ _id: apptId, [field]: { $ne: true } }, { $set: { [field]: true } });
  return r.modifiedCount === 1;
}

/** Send owner push reminders for due items (deduplicated by atomic claim). */
async function sendPushes(db, due, notifyBusiness) {
  let sent = 0;
  for (const d of due) {
    if (!d.wantsPush) continue;
    if (!(await claim(db, d.appt._id, `pushReminders.${d.key}`))) continue;
    sent++;
    void Promise.resolve(notifyBusiness(d.biz._id, {
      titleKey: 'reminder_title',
      bodyKey: 'reminder_body',
      payload: { customerName: d.appt.customerName, serviceName: d.appt.serviceName, date: d.appt.date, time: d.appt.startTime },
      url: '/(dashboard)/appointments',
    })).catch(err => console.error('[reminders] push error', err && err.message));
  }
  return sent;
}

/** Customer WhatsApp/SMS reminders, only when a real provider is configured. */
async function sendCustomerReminders(db, due, reminderService) {
  let sent = 0, failed = 0;
  for (const d of due) {
    if (!d.wantsWhatsApp) continue;
    const field = `reminders.${d.key}`;
    if (!(await claim(db, d.appt._id, field))) continue;
    const result = await reminderService.sendReminder(d.appt.customerPhone, d.message);
    if (result && result.success) sent++;
    else {
      failed++;
      await db.collection('appointments').updateOne({ _id: d.appt._id }, { $unset: { [field]: '' } });
    }
  }
  return { sent, failed };
}

/** WhatsApp reminders in the legacy /api/reminders/check response format (for the external cron). */
function toCheckPayload(due) {
  return due.filter(d => d.wantsWhatsApp).map(d => ({
    appointmentId: d.appt._id.toString(),
    businessId: d.biz._id.toString(),
    customerPhone: d.appt.customerPhone,
    customerName: d.appt.customerName,
    message: d.message,
    intervalKey: d.key,
  }));
}

async function runOnce({ db, notifyBusiness, reminderService, nowMs = Date.now() }) {
  const due = await findDue(db, nowMs);
  const pushSent = await sendPushes(db, due, notifyBusiness);
  let customer = { sent: 0, failed: 0, skipped: 0 };
  if (reminderService && reminderService.isConfigured()) {
    customer = { ...(await sendCustomerReminders(db, due, reminderService)), skipped: 0 };
  } else {
    // No SMS/WhatsApp provider here: leave customer reminders unclaimed so the external
    // cron (/api/reminders/check + /mark-sent) can still deliver them.
    customer.skipped = due.filter(d => d.wantsWhatsApp).length;
  }
  return { due: due.length, pushSent, customer };
}

async function acquireLock(db, name, owner, ttlMs) {
  const now = new Date();
  try {
    await db.collection('locks').updateOne(
      { _id: name, $or: [{ lockedUntil: { $lt: now } }, { owner }] },
      { $set: { lockedUntil: new Date(now.getTime() + ttlMs), owner } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false; // held by another instance
    throw err;
  }
}

function startScheduler({ getDb, notifyBusiness, reminderService, intervalMs = 60000 }) {
  const owner = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let running = false;
  const tick = async () => {
    const db = getDb();
    if (!db || running) return;
    running = true;
    try {
      if (!(await acquireLock(db, 'reminders', owner, Math.max(intervalMs - 5000, 5000)))) return;
      const r = await runOnce({ db, notifyBusiness, reminderService });
      if (r.pushSent || r.customer.sent || r.customer.failed) console.log('[reminders] tick', JSON.stringify(r));
    } catch (err) {
      console.error('[reminders] tick error', err && err.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  setTimeout(tick, 5000).unref?.();
  console.log(`[reminders] in-process scheduler started (every ${Math.round(intervalMs / 1000)}s)`);
  return { stop: () => clearInterval(timer), tick };
}

module.exports = { INTERVALS, VALID_KEYS, GRACE_MIN, findDue, sendPushes, sendCustomerReminders, toCheckPayload, runOnce, acquireLock, startScheduler, renderTemplate, setManageUrlBuilder, DEFAULT_TEMPLATE };
