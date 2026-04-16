const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const QA = '/home/itziktdk/.openclaw/workspace/picktime/qa-fab-redo';

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
  const loginData = JSON.parse(loginRes);
  const token = loginData.token;
  console.log('Login:', loginData.exists, 'slug:', loginData.business?.slug);
  if (!token) { console.log('No token'); return; }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate((t) => { localStorage.setItem('snaptor_token', t); }, token);

  // 1. Appointments page
  await page.goto('http://localhost:3000/appointments', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(QA, '01-appointments.png'), fullPage: true });
  console.log('1: Appointments page');

  // 2. Check for FAB
  const fabVisible = await page.evaluate(() => {
    const els = document.querySelectorAll('[style]');
    for (const el of els) {
      const s = el.getAttribute('style') || '';
      if (s.includes('position: absolute') && s.includes('bottom') && s.includes('border-radius: 28px')) return true;
    }
    return false;
  });
  console.log('FAB visible:', fabVisible);
  await page.screenshot({ path: path.join(QA, '02-fab-visible.png') });

  // 3. Click FAB
  if (fabVisible) {
    await page.click('[style*="border-radius: 28px"]');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(QA, '03-modal-open.png'), fullPage: true });
    console.log('3: Modal should be open');
  } else {
    // Try bottom-right click
    await page.mouse.click(366, 796);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(QA, '03-modal-attempt.png'), fullPage: true });
    console.log('3: Tried clicking bottom-right');
  }

  // 4. Dashboard to verify theme not broken
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(QA, '04-dashboard.png'), fullPage: true });
  console.log('4: Dashboard (theme check)');

  await browser.close();
  console.log('All done');
})();
