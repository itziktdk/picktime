const { test } = require('playwright/test');
const BASE = 'http://localhost:3000';
const dir = '/home/itziktdk/.openclaw/workspace/picktime/qa-progress';

test('dashboard with analytics after login', async ({ page }) => {
  // Login via API to get token
  const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
    data: { phone: '0501234567', slug: 'narkis11' }
  });
  const loginData = await loginRes.json();
  
  // Set localStorage with auth data
  await page.goto(`${BASE}/dashboard.html`);
  await page.evaluate((data) => {
    localStorage.setItem('snaptor_token', data.token);
    localStorage.setItem('snaptor_business', JSON.stringify(data.business));
  }, loginData);
  
  // Reload to pick up auth
  await page.reload();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${dir}/04-dashboard-logged-in.png`, fullPage: true });
});
