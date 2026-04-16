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
  const loginRes = await post('http://localhost:3000/api/auth/login', { phone: '0501234567' });
  const { token } = JSON.parse(loginRes);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Capture console errors
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text()); });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
  await page.evaluate((t) => { localStorage.setItem('snaptor_token', t); }, token);

  // Navigate to dashboard and wait for content
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(8000);
  
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Body text:', bodyText);
  
  await page.screenshot({ path: path.join(QA, '12-dashboard.png'), fullPage: true });

  // Try appointments
  await page.goto('http://localhost:3000/appointments', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(8000);
  
  const bodyText2 = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Appointments text:', bodyText2);
  
  await page.screenshot({ path: path.join(QA, '13-appointments.png'), fullPage: true });

  await browser.close();
  console.log('Done');
})();
