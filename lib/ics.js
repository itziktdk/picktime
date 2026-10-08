'use strict';
// Minimal RFC 5545 calendar file for one appointment (.ics download; Apple/Outlook/Google).
const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Fold lines longer than 75 octets (UTF-8 safe: never split a multi-byte character).
function fold(line) {
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

function buildIcs({ uid, startMs, endMs, summary, description, location, url, cancelled, sequence = 0, stampMs = Date.now() }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Snaptor//Appointments//HE', 'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utc(stampMs)}`,
    `DTSTART:${utc(startMs)}`,
    `DTEND:${utc(endMs)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${esc(summary)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    location ? `LOCATION:${esc(location)}` : null,
    url ? `URL:${url}` : null,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    cancelled ? null : 'BEGIN:VALARM', cancelled ? null : 'ACTION:DISPLAY', cancelled ? null : `DESCRIPTION:${esc(summary)}`, cancelled ? null : 'TRIGGER:-PT1H', cancelled ? null : 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs, esc, fold };
