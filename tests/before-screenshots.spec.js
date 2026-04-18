const { test } = require('playwright/test');
const BASE = 'http://localhost:3000';
const dir = '/home/itziktdk/.openclaw/workspace/picktime/qa-progress';

test('before - booking page', async ({ page }) => {
  await page.goto(`${BASE}/book/narkis11`);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  await page.screenshot({ path: `${dir}/01-before-booking.png`, fullPage: true });
});

test('before - dashboard', async ({ page }) => {
  await page.goto(`${BASE}/dashboard.html`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${dir}/01-before-dashboard.png`, fullPage: true });
});
