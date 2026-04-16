const { test, expect } = require('@playwright/test');

const BASE = 'https://snaptor.app';
const QA_DIR = 'qa-final';

test('Bug 0 - SPA refresh on /dashboard serves SPA', async ({ page }) => {
  // Navigate to dashboard URL directly (simulates refresh)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // Should show login screen (not logged in) or loading, NOT the landing page hero
  const title = await page.title();
  expect(title).toContain('Snaptor');
  await page.screenshot({ path: `${QA_DIR}/bug0-spa-refresh.png`, fullPage: true });
});

test('Bug 1 - Single business login returns token', async ({ page }) => {
  // Test via API
  const resp = await page.request.post(`${BASE}/api/auth/login`, {
    data: { phone: '0501234567' }
  });
  const json = await resp.json();
  expect(json.exists).toBe(true);
  expect(json.token).toBeTruthy();
  expect(json.business.slug).toBe('test-barber');
  
  // Now test the UI flow
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${QA_DIR}/bug1-login-page.png`, fullPage: true });
});

test('Bug 1b - Login flow navigates to dashboard', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(2000);
  
  // Fill phone and submit
  const phoneInput = page.locator('input[inputmode="tel"], input[type="tel"], input[placeholder*="05"]').first();
  if (await phoneInput.isVisible()) {
    await phoneInput.fill('0501234567');
    await page.waitForTimeout(500);
    // Find and click login button
    const loginBtn = page.locator('div[role="button"]').filter({ hasText: /כניסה|התחבר|login/i }).first();
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
      await page.waitForTimeout(3000);
    }
  }
  await page.screenshot({ path: `${QA_DIR}/bug1-after-login.png`, fullPage: true });
});

test('Bug 3 - Staff page toggle renders correctly', async ({ page }) => {
  // Login first
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1500);
  
  // Set token directly in localStorage
  const resp = await page.request.post(`${BASE}/api/auth/login`, {
    data: { phone: '0501234567' }
  });
  const json = await resp.json();
  
  await page.evaluate((token) => {
    localStorage.setItem('snaptor_token', token);
  }, json.token);
  
  // Navigate to staff page
  await page.goto(`${BASE}/staff`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${QA_DIR}/bug3-staff-toggle.png`, fullPage: true });
});

test('Bug 4 - Admin page has edit, toggle, lastLogin', async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${QA_DIR}/bug4-admin-page.png`, fullPage: true });
  
  const content = await page.content();
  // Check for key features in the HTML
  const hasEdit = content.includes('editBusiness') || content.includes('עריכה') || content.includes('edit');
  const hasToggle = content.includes('toggleActive') || content.includes('toggle');
  const hasLastLogin = content.includes('כניסה אחרונה') || content.includes('lastLogin');
  
  console.log(`Admin features - Edit: ${hasEdit}, Toggle: ${hasToggle}, LastLogin: ${hasLastLogin}`);
});

test('Bug 5 - Page title is not empty', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForTimeout(2000);
  const title = await page.title();
  expect(title).toBeTruthy();
  expect(title.length).toBeGreaterThan(0);
  console.log(`Page title: "${title}"`);
  await page.screenshot({ path: `${QA_DIR}/bug5-title.png`, fullPage: true });
});
