const { test, expect } = require('playwright/test');

const BASE = 'http://localhost:3000';

test.describe('Public Booking Page', () => {
  test('loads business info', async ({ page }) => {
    await page.goto(`${BASE}/book/narkis11`);
    await expect(page.locator('#biz-name')).toHaveText('נרקיס', { timeout: 10000 });
    await expect(page.locator('#app')).toBeVisible();
  });

  test('shows 404 for invalid slug', async ({ page }) => {
    await page.goto(`${BASE}/book/nonexistent-biz`);
    await expect(page.locator('#not-found')).toBeVisible({ timeout: 10000 });
  });

  test('shows services list', async ({ page }) => {
    await page.goto(`${BASE}/book/narkis11`);
    await expect(page.locator('#biz-name')).toHaveText('נרקיס', { timeout: 10000 });
    const services = page.locator('.service-item');
    await expect(services.first()).toBeVisible();
    const count = await services.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('service selection shows date picker', async ({ page }) => {
    await page.goto(`${BASE}/book/narkis11`);
    await expect(page.locator('#biz-name')).toHaveText('נרקיס', { timeout: 10000 });
    await page.locator('.service-item').first().click();
    await expect(page.locator('#step-date')).toBeVisible();
    await expect(page.locator('#month-label')).toBeVisible();
  });
});
