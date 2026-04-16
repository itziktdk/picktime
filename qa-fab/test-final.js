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
    req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  // Login to test business
  const loginRes = await post('http://localhost:3000/api/auth/login', { phone: '0501234567' });
  const loginData = JSON.parse(loginRes);
  const token = loginData.token;
  const slug = loginData.business?.slug;
  console.log('Login:', loginData.exists, slug);
  if (!token) { console.log('No token'); return; }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Set token before navigating
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate((t) => { localStorage.setItem('snaptor_token', t); }, token);

  // Go to appointments
  await page.goto('http://localhost:3000/appointments', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(QA, '10-appointments-final.png'), fullPage: true });
  console.log('Screenshot: appointments');

  // Go to dashboard
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(QA, '11-dashboard-final.png'), fullPage: true });
  console.log('Screenshot: dashboard');

  await browser.close();
  console.log('Done');
})();
