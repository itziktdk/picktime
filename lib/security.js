'use strict';
// Content-Security-Policy and CORS configuration.

const SPA_POLICY = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  // react-native-web injects <style> tags at runtime
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'media-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
};

// public/admin.html and public/book.html use inline <script> and on* handlers and Google Fonts.
const LEGACY_POLICY = {
  ...SPA_POLICY,
  'script-src': ["'self'", "'unsafe-inline'"],
  'script-src-attr': ["'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
};

function serialize(policy, reportUri) {
  const parts = Object.entries(policy).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (reportUri) parts.push(`report-uri ${reportUri}`);
  return parts.join('; ');
}

function isLegacyPage(path) {
  return path === '/admin' || path === '/admin.html' || path === '/book.html' || path.startsWith('/book/');
}

function cspMiddleware(env) {
  const mode = String(env.CSP_MODE || 'enforce').toLowerCase();
  if (mode === 'off') return (req, res, next) => next();
  const header = mode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const spa = serialize(SPA_POLICY, '/api/csp-report');
  const legacy = serialize(LEGACY_POLICY, '/api/csp-report');
  return (req, res, next) => {
    if (!req.path.startsWith('/api/')) res.setHeader(header, isLegacyPage(req.path) ? legacy : spa);
    next();
  };
}

const DEFAULT_ORIGINS = ['https://snaptor.app', 'https://www.snaptor.app', 'https://picktime-app.azurewebsites.net'];

function allowedOrigins(env) {
  const extra = String(env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

function corsOptions(env, isProd) {
  const allowed = allowedOrigins(env);
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin navigation, curl, native apps
      if (allowed.has(origin)) return cb(null, true);
      if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      return cb(null, false); // no CORS headers → the browser blocks the response
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  };
}

function summarizeCspReport(body) {
  const r = (body && (body['csp-report'] || (Array.isArray(body) && body[0] && body[0].body) || body.body)) || body || {};
  const pick = (k1, k2) => String(r[k1] || r[k2] || '').slice(0, 200);
  return `directive=${pick('violated-directive', 'effectiveDirective')} blocked=${pick('blocked-uri', 'blockedURL')} doc=${pick('document-uri', 'documentURL')}`;
}

module.exports = { SPA_POLICY, LEGACY_POLICY, serialize, cspMiddleware, corsOptions, allowedOrigins, summarizeCspReport, isLegacyPage };
