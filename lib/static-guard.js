'use strict';
// L-14: real robots.txt / sitemap.xml / manifest.json; no SPA HTML for dotfiles, server files or
// missing static files; stale pre-SPA exports (login.html, dashboard.html, "(auth)/…") redirect
// to their routes. M-21: long-lived caching for content-hashed bundles and assets.

const LEGACY_HTML = new Set(['/admin.html', '/book.html']);
const STATIC_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|ttf|otf|woff2?|eot|txt|xml|json|webmanifest|env|php|asp|aspx|jsp|cgi|ya?ml|ini|conf|bak|old|orig|sql|sqlite|db|log|zip|tar|gz|tgz|rar|7z|pem|key|crt|sh|py|rb|ds_store)$/i;
const SERVER_PATHS = /^\/(server\.js|reminder-service\.js|package(-lock)?\.json|web\.config|node_modules|lib|test|scripts)(\/|$)/i;

function siteBase(env) { return (env.PUBLIC_BASE_URL || 'https://snaptor.app').replace(/\/+$/, ''); }

function robotsTxt(env) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /*/manage/',
    'Disallow: /dashboard', 'Disallow: /appointments', 'Disallow: /customers', 'Disallow: /customer-detail',
    'Disallow: /tasks', 'Disallow: /settings', 'Disallow: /services', 'Disallow: /staff',
    `Sitemap: ${siteBase(env)}/sitemap.xml`,
    '',
  ].join('\n');
}

function sitemapXml(env) {
  const base = siteBase(env);
  const urls = ['/', '/register', '/privacy', '/support'];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${base}${u}</loc></url>`).join('\n') + '\n</urlset>\n';
}

function manifestJson() {
  return {
    name: 'Snaptor — ניהול תורים',
    short_name: 'Snaptor',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    dir: 'rtl',
    lang: 'he',
    background_color: '#ffffff',
    theme_color: '#1e3a5f',
    icons: [{ src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' }],
  };
}

/** Where a stale pre-SPA export should go, or null. */
function staleRedirect(p) {
  if (LEGACY_HTML.has(p)) return null;
  if (/^\/(\(auth\)|\(dashboard\))\//.test(p) || /^\/\[slug\]/.test(p) || /^\/(\+not-found|_sitemap)\.html$/.test(p)) {
    const m = p.match(/\/([a-z-]+)\.html$/);
    if (/^\/\(auth\)\//.test(p) && m) return '/' + m[1];
    if (/^\/\(dashboard\)\//.test(p) && m) return m[1] === 'index' ? '/dashboard' : '/' + m[1];
    return '/';
  }
  const m = p.match(/^\/([a-z-]+)\.html$/);
  if (m) return m[1] === 'index' ? '/' : '/' + m[1];
  return null;
}

function notFound(res) { res.status(404).type('text/plain').send('Not found'); }

/** Runs BEFORE express.static. */
function guard(env) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p = req.path;
    if (p.startsWith('/api/')) return next();
    try { p = decodeURIComponent(p); } catch { return notFound(res); }
    if (p === '/robots.txt') return res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsTxt(env));
    if (p === '/sitemap.xml') return res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapXml(env));
    if (p === '/manifest.json' || p === '/manifest.webmanifest') return res.type('application/manifest+json').set('Cache-Control', 'public, max-age=3600').send(JSON.stringify(manifestJson()));
    if (/(^|\/)\.(?!well-known\/)/.test(p)) return notFound(res); // dotfiles: /.env, /.git/…
    if (SERVER_PATHS.test(p)) return notFound(res);
    const to = staleRedirect(p);
    if (to) return res.redirect(301, to);
    next();
  };
}

/** Runs AFTER express.static: a missing file with a static extension is a 404, not the SPA. */
function missingStatic(req, res, next) {
  if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api/') && STATIC_EXT.test(req.path)) return notFound(res);
  next();
}

const HASHED = /(\/_expo\/static\/|\.[a-f0-9]{16,}\.[a-z0-9]+$)/i;
function staticHeaders(res, filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (HASHED.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
}

module.exports = { guard, missingStatic, staticHeaders, staleRedirect, robotsTxt, sitemapXml, manifestJson };
