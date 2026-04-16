# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: qa-final.spec.js >> Bug 3 - Staff page toggle renders correctly
- Location: tests/qa-final.spec.js:51:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
Call log:
  - navigating to "https://snaptor.app/login", waiting until "load"

```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | 
  3  | const BASE = 'https://snaptor.app';
  4  | const QA_DIR = 'qa-final';
  5  | 
  6  | test('Bug 0 - SPA refresh on /dashboard serves SPA', async ({ page }) => {
  7  |   // Navigate to dashboard URL directly (simulates refresh)
  8  |   await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  9  |   await page.waitForTimeout(2000);
  10 |   // Should show login screen (not logged in) or loading, NOT the landing page hero
  11 |   const title = await page.title();
  12 |   expect(title).toContain('Snaptor');
  13 |   await page.screenshot({ path: `${QA_DIR}/bug0-spa-refresh.png`, fullPage: true });
  14 | });
  15 | 
  16 | test('Bug 1 - Single business login returns token', async ({ page }) => {
  17 |   // Test via API
  18 |   const resp = await page.request.post(`${BASE}/api/auth/login`, {
  19 |     data: { phone: '0501234567' }
  20 |   });
  21 |   const json = await resp.json();
  22 |   expect(json.exists).toBe(true);
  23 |   expect(json.token).toBeTruthy();
  24 |   expect(json.business.slug).toBe('test-barber');
  25 |   
  26 |   // Now test the UI flow
  27 |   await page.goto(`${BASE}/login`);
  28 |   await page.waitForTimeout(1500);
  29 |   await page.screenshot({ path: `${QA_DIR}/bug1-login-page.png`, fullPage: true });
  30 | });
  31 | 
  32 | test('Bug 1b - Login flow navigates to dashboard', async ({ page }) => {
  33 |   await page.goto(`${BASE}/login`);
  34 |   await page.waitForTimeout(2000);
  35 |   
  36 |   // Fill phone and submit
  37 |   const phoneInput = page.locator('input[inputmode="tel"], input[type="tel"], input[placeholder*="05"]').first();
  38 |   if (await phoneInput.isVisible()) {
  39 |     await phoneInput.fill('0501234567');
  40 |     await page.waitForTimeout(500);
  41 |     // Find and click login button
  42 |     const loginBtn = page.locator('div[role="button"]').filter({ hasText: /כניסה|התחבר|login/i }).first();
  43 |     if (await loginBtn.isVisible()) {
  44 |       await loginBtn.click();
  45 |       await page.waitForTimeout(3000);
  46 |     }
  47 |   }
  48 |   await page.screenshot({ path: `${QA_DIR}/bug1-after-login.png`, fullPage: true });
  49 | });
  50 | 
  51 | test('Bug 3 - Staff page toggle renders correctly', async ({ page }) => {
  52 |   // Login first
> 53 |   await page.goto(`${BASE}/login`);
     |              ^ Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
  54 |   await page.waitForTimeout(1500);
  55 |   
  56 |   // Set token directly in localStorage
  57 |   const resp = await page.request.post(`${BASE}/api/auth/login`, {
  58 |     data: { phone: '0501234567' }
  59 |   });
  60 |   const json = await resp.json();
  61 |   
  62 |   await page.evaluate((token) => {
  63 |     localStorage.setItem('snaptor_token', token);
  64 |   }, json.token);
  65 |   
  66 |   // Navigate to staff page
  67 |   await page.goto(`${BASE}/staff`);
  68 |   await page.waitForTimeout(2000);
  69 |   await page.screenshot({ path: `${QA_DIR}/bug3-staff-toggle.png`, fullPage: true });
  70 | });
  71 | 
  72 | test('Bug 4 - Admin page has edit, toggle, lastLogin', async ({ page }) => {
  73 |   await page.goto(`${BASE}/admin`);
  74 |   await page.waitForTimeout(2000);
  75 |   await page.screenshot({ path: `${QA_DIR}/bug4-admin-page.png`, fullPage: true });
  76 |   
  77 |   const content = await page.content();
  78 |   // Check for key features in the HTML
  79 |   const hasEdit = content.includes('editBusiness') || content.includes('עריכה') || content.includes('edit');
  80 |   const hasToggle = content.includes('toggleActive') || content.includes('toggle');
  81 |   const hasLastLogin = content.includes('כניסה אחרונה') || content.includes('lastLogin');
  82 |   
  83 |   console.log(`Admin features - Edit: ${hasEdit}, Toggle: ${hasToggle}, LastLogin: ${hasLastLogin}`);
  84 | });
  85 | 
  86 | test('Bug 5 - Page title is not empty', async ({ page }) => {
  87 |   await page.goto(BASE);
  88 |   await page.waitForTimeout(2000);
  89 |   const title = await page.title();
  90 |   expect(title).toBeTruthy();
  91 |   expect(title.length).toBeGreaterThan(0);
  92 |   console.log(`Page title: "${title}"`);
  93 |   await page.screenshot({ path: `${QA_DIR}/bug5-title.png`, fullPage: true });
  94 | });
  95 | 
```