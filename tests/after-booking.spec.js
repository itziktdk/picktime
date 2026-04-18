const { test, expect } = require('playwright/test');
const BASE = 'http://localhost:3000';
const dir = '/home/itziktdk/.openclaw/workspace/picktime/qa-progress';

test('after - booking page loads with theme', async ({ page }) => {
  await page.goto(`${BASE}/book/narkis11`);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  await page.screenshot({ path: `${dir}/02-after-booking-themed.png`, fullPage: true });
  // Verify theme was applied (amber)
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  expect(accent).toBe('#f59e0b');
});

test('after - service selection works', async ({ page }) => {
  await page.goto(`${BASE}/book/narkis11`);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  await page.locator('.service-item').first().click();
  await expect(page.locator('#step-date')).toBeVisible();
  await page.screenshot({ path: `${dir}/02-after-booking-date.png`, fullPage: true });
});

test('after - date and time selection', async ({ page }) => {
  await page.goto(`${BASE}/book/narkis11`);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  await page.locator('.service-item').first().click();
  await expect(page.locator('#step-date')).toBeVisible();
  // Click a non-disabled date cell
  const cells = page.locator('.date-cell:not(.disabled)');
  const count = await cells.count();
  if (count > 0) {
    await cells.first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${dir}/02-after-booking-time.png`, fullPage: true });
  }
});
