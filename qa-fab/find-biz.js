const { chromium } = require('playwright');
const path = require('path');
const QA = path.join(__dirname);

// Try to login with the admin panel to find businesses
const http = require('http');

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

(async () => {
  // Get admin token
  const loginRes = await fetch('http://localhost:3000/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'snaptor2026' })
  });
  const { token } = JSON.parse(loginRes);
  console.log('Admin token acquired');

  // Try to get businesses list
  // Check admin endpoints
  const statsRes = await fetch('http://localhost:3000/api/admin/dashboard', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Dashboard:', statsRes.substring(0, 500));
})();
