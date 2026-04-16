const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

test('login with multi-business phone shows business selector', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  
  // Wait for login form
  await page.waitForSelector('input[type="tel"]', { timeout: 10000 });
  
  // Enter multi-business phone number
  await page.fill('input[type="tel"]', '0546666094');
  
  // Click login button
  await page.locator('button[role="button"]').filter({ hasText: /התחברות/i }).first().click();
  
  // Wait for business selection to appear
  await page.waitForSelector('text=בחר עסק', { timeout: 10000 });
  
  // Should show both businesses
  await expect(page.locator('text=נרקיס')).toBeVisible();
  await expect(page.locator('text=מנשה צדקה')).toBeVisible();
  
  console.log('✅ Multi-business login selector works!');
});
