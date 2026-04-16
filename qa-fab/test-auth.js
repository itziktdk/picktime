const { chromium } = require('playwright');
const path = require('path');
const QA = path.join(__dirname);
const http = require('http');

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  // Try login with some phone numbers to find an existing business
  const phones = ['0504837363', '0526333870', '0543388227', '0522907087', '0529467014'];
  let token, slug;
  for (const phone of phones) {
    try {
      const res = await post('http://localhost:3000/api/auth/login', { phone });
      const data = JSON.parse(res);
      console.log(`${phone}: exists=${data.exists}, slug=${data.business?.slug}`);
      if (data.exists && data.token) {
        token = data.token;
        slug = data.business?.slug;
        break;
      }
    } catch (e) {
      console.log(`${phone}: error ${e.message}`);
    }
  }
  if (!token) {
    console.log('No business found, trying to create one...');
    // Create a test business
    const createRes = await post('http://localhost:3000/api/businesses', {
      name: 'Test Biz',
      slug: 'test-biz',
      phone: '0501234567',
      type: 'barber',
      services: [{ name: 'Haircut', duration: 30, price: 50 }],
      workingHours: { sunday: { enabled: true, start: '09:00', end: '18:00' } },
      theme: 'default'
    });
    console.log('Create:', createRes.substring(0, 300));
    const cd = JSON.parse(createRes);
    if (cd.token) { token = cd.token; slug = cd.business?.slug || 'test-biz'; }
  }
  if (!token) { console.log('Could not get token'); return; }
  console.log('Using slug:', slug, 'token length:', token.length);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Inject auth token into localStorage and navigate
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate((t) => { localStorage.setItem('auth_token', t); }, token);
  await page.goto('http://localhost:3000/appointments', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(QA, '08-appointments-authed.png'), fullPage: true });
  console.log('Screenshot: appointments page (authed)');

  // Also check the index/dashboard
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(QA, '09-dashboard.png'), fullPage: true });
  console.log('Screenshot: dashboard');

  await browser.close();
  console.log('Done');
})();
