'use strict';
// Sprint 2: two-way calendar sync with Google Calendar and Outlook (Microsoft Graph).
// OFF unless <PROVIDER>_CALENDAR_SYNC_ENABLED=true and the OAuth app credentials are set, plus
// CALSYNC_ENC_KEY (32+ chars) to encrypt stored refresh tokens.
//  - push: Snaptor bookings → events in the connected calendar (create / update / delete)
//  - pull: busy times in the connected calendar block online booking slots (owner can still book)
const crypto = require('crypto');

const PROVIDERS = {
  google: {
    env: 'GOOGLE', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
    extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  outlook: {
    env: 'MS', authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'offline_access Calendars.ReadWrite', extraAuth: { response_mode: 'query' },
  },
};

function creds(provider, env = process.env) {
  const p = PROVIDERS[provider]; if (!p) return null;
  return { id: env[`${p.env}_CLIENT_ID`], secret: env[`${p.env}_CLIENT_SECRET`] };
}
function isEnabled(provider, env = process.env) {
  const p = PROVIDERS[provider]; if (!p) return false;
  const c = creds(provider, env);
  return env[`${p.env === 'MS' ? 'OUTLOOK' : 'GOOGLE'}_CALENDAR_SYNC_ENABLED`] === 'true' && !!c.id && !!c.secret && String(env.CALSYNC_ENC_KEY || '').length >= 32;
}
const redirectUri = (base, provider) => `${base}/api/calendar-sync/${provider}/callback`;

function authUrl(provider, { state, base }) {
  const p = PROVIDERS[provider];
  const q = new URLSearchParams({ client_id: creds(provider).id, redirect_uri: redirectUri(base, provider), response_type: 'code', scope: p.scope, state, ...p.extraAuth });
  return `${p.authUrl}?${q}`;
}

// AES-256-GCM for refresh tokens at rest.
function key() { return crypto.createHash('sha256').update(String(process.env.CALSYNC_ENC_KEY || '')).digest(); }
function encrypt(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function decrypt(blob) {
  const [iv, tag, enc] = String(blob || '').split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

async function tokenRequest(provider, params, fetchImpl = fetch) {
  const c = creds(provider);
  const res = await fetchImpl(PROVIDERS[provider].tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }).toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`token ${provider} ${res.status} ${j.error || ''}`.trim());
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 };
}
const exchangeCode = (provider, code, base, f) => tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(base, provider) }, f);
const refresh = (provider, refreshToken, f) => tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken }, f);

/** Event body for a booking. Times are local wall-clock + IANA zone (both APIs accept that). */
function toEvent(provider, appt, { tz, businessName }) {
  const subject = [appt.customerName, appt.serviceName].filter(Boolean).join(' · ') || 'Snaptor';
  const body = [businessName, appt.customerPhone, appt.notes].filter(Boolean).join('\n');
  const start = `${appt.date}T${appt.startTime}:00`, end = `${appt.date}T${appt.endTime || appt.startTime}:00`;
  if (provider === 'google') return { summary: subject, description: body, start: { dateTime: start, timeZone: tz }, end: { dateTime: end, timeZone: tz }, extendedProperties: { private: { snaptorId: String(appt._id) } } };
  const winTz = tz === 'Asia/Jerusalem' ? 'Israel Standard Time' : tz;
  return { subject, body: { contentType: 'text', content: body }, start: { dateTime: start, timeZone: winTz }, end: { dateTime: end, timeZone: winTz }, categories: ['Snaptor'] };
}

async function api(provider, accessToken, method, path, body, fetchImpl = fetch) {
  const base = provider === 'google' ? 'https://www.googleapis.com/calendar/v3' : 'https://graph.microsoft.com/v1.0';
  const res = await fetchImpl(base + path, { method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204 || res.status === 404 || res.status === 410) return { status: res.status };
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${provider} ${method} ${path} ${res.status}`);
  return { status: res.status, json: j };
}

/** Create or update the event; returns the event id. */
async function upsertEvent(provider, accessToken, appt, ctx, eventId, f) {
  const ev = toEvent(provider, appt, ctx);
  const path = provider === 'google' ? '/calendars/primary/events' : '/me/events';
  if (eventId) {
    const r = await api(provider, accessToken, provider === 'google' ? 'PUT' : 'PATCH', `${path}/${encodeURIComponent(eventId)}`, ev, f);
    if (r.status !== 404 && r.status !== 410) return eventId;
  }
  return (await api(provider, accessToken, 'POST', path, ev, f)).json.id;
}
async function deleteEvent(provider, accessToken, eventId, f) {
  const path = provider === 'google' ? '/calendars/primary/events' : '/me/events';
  await api(provider, accessToken, 'DELETE', `${path}/${encodeURIComponent(eventId)}`, null, f);
}

/** Busy intervals [{start, end}] (epoch ms) in [fromIso, toIso), excluding Snaptor's own events. */
async function busy(provider, accessToken, fromIso, toIso, f) {
  if (provider === 'google') {
    // List events (not freeBusy) so our own pushed events can be excluded.
    const q = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: 'true', maxResults: '250' });
    const r = await api(provider, accessToken, 'GET', `/calendars/primary/events?${q}`, null, f);
    return ((r.json && r.json.items) || []).filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent' && !(e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.snaptorId) && e.start && e.start.dateTime)
      .map(e => ({ start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), id: e.id }));
  }
  const q = new URLSearchParams({ startDateTime: fromIso, endDateTime: toIso, $top: '250', $select: 'id,start,end,showAs,isCancelled,categories' });
  const r = await api(provider, accessToken, 'GET', `/me/calendarView?${q}`, null, f);
  return ((r.json && r.json.value) || []).filter(e => !e.isCancelled && e.showAs !== 'free' && !(e.categories || []).includes('Snaptor'))
    .map(e => ({ start: Date.parse(e.start.dateTime + 'Z'), end: Date.parse(e.end.dateTime + 'Z'), id: e.id }));
}

module.exports = { PROVIDERS, isEnabled, authUrl, redirectUri, encrypt, decrypt, exchangeCode, refresh, toEvent, upsertEvent, deleteEvent, busy };
