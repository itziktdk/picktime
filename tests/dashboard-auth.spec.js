const { test } = require('playwright/test');
const BASE = 'http://localhost:3000';
const dir = '/home/itziktdk/.openclaw/workspace/picktime/qa-progress';

test('dashboard with proper auth', async ({ page }) => {
  // First navigate to get the page loaded
  await page.goto(`${BASE}/dashboard.html`);
  await page.waitForTimeout(1000);
  
  // Login via API
  const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
    data: { phone: '0501234567', slug: 'narkis11' }
  });
  const loginData = await loginRes.json();
  
  // Set localStorage
  await page.evaluate((data) => {
    localStorage.setItem('snaptor_token', data.token);
  }, loginData);
  
  // Reload
  await page.reload();
  await page.waitForTimeout(5000);
  
  // Check console errors
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  await page.screenshot({ path: `${dir}/05-dashboard-auth.png`, fullPage: true });
  
  // Also try the SPA route
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(1000);
  await page.evaluate((data) => {
    localStorage.setItem('snaptor_token', data.token);
  }, loginData);
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${dir}/05-dashboard-spa.png`, fullPage: true });
});
