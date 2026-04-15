const { test, expect } = require('playwright/test');

const BASE = 'http://localhost:3000';

test.describe('Admin Dashboard Browser Tests', () => {
  test('admin page loads', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#password-input')).toBeVisible();
  });

  test('login with correct password', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.fill('#password-input', 'snaptor2026');
    await page.click('button:has-text("כניסה")');
    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 10000 });
    // Stats should load
    await expect(page.locator('#s-biz')).not.toHaveText('-', { timeout: 10000 });
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.fill('#password-input', 'wrong');
    await page.click('button:has-text("כניסה")');
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 5000 });
  });

  test('tabs switch content', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.fill('#password-input', 'snaptor2026');
    await page.click('button:has-text("כניסה")');
    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 10000 });
    
    // Click customers tab
    await page.click('[data-tab="customers"]');
    await expect(page.locator('[data-tab="customers"].active')).toBeVisible();
    
    // Click appointments tab
    await page.click('[data-tab="appointments"]');
    await expect(page.locator('[data-tab="appointments"].active')).toBeVisible();
    
    // Click back to businesses
    await page.click('[data-tab="businesses"]');
    await expect(page.locator('[data-tab="businesses"].active')).toBeVisible();
  });
});
