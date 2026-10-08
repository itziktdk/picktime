'use strict';
// Time-zone aware date helpers. Appointment dates/times are stored as local
// wall-clock strings ("YYYY-MM-DD", "HH:MM") in the business time zone.

const DEFAULT_TZ = 'Asia/Jerusalem';
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function businessTz(business) {
  const tz = business && business.timezone;
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

const dtfCache = new Map();
function partsFormatter(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(tz);
}

function zonedParts(tz, ms = Date.now()) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second),
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** Current local date/time in tz: { date: 'YYYY-MM-DD', time: 'HH:MM', minutes } */
function nowInTz(tz = DEFAULT_TZ, ms = Date.now()) {
  const p = zonedParts(tz, ms);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, minutes: p.hour * 60 + p.minute };
}

function todayInTz(tz = DEFAULT_TZ, ms = Date.now()) { return nowInTz(tz, ms).date; }

function isValidYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidHM(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function hmToMin(s) { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; }
function minToHM(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }

/** Day name ('sunday'..) for a calendar date string, independent of server TZ. */
function dayNameOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function tzOffsetMs(tz, utcMs) {
  const p = zonedParts(tz, utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Epoch ms of a wall-clock date+time in tz. */
function zonedTimeToUtcMs(ymd, hm, tz = DEFAULT_TZ) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(tz, guess);
  let ts = guess - off1;
  const off2 = tzOffsetMs(tz, ts);
  if (off2 !== off1) ts = guess - off2;
  return ts;
}

module.exports = {
  DEFAULT_TZ, DAY_NAMES, isValidTimeZone, businessTz, nowInTz, todayInTz, isValidYMD, isValidHM,
  hmToMin, minToHM, dayNameOf, addDays, zonedTimeToUtcMs,
};
