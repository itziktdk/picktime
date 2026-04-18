const { test } = require('playwright/test');
const BASE = 'http://localhost:3000';
const dir = '/home/itziktdk/.openclaw/workspace/picktime/qa-progress';

test('after - dashboard with analytics', async ({ page }) => {
  // Login first
  await page.goto(`${BASE}/login.html`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${dir}/03-dashboard-login.png`, fullPage: true });
  
  // Try direct dashboard access
  await page.goto(`${BASE}/dashboard.html`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${dir}/03-dashboard-after.png`, fullPage: true });
});
