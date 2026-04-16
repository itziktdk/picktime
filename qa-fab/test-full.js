const { chromium } = require('playwright');
const path = require('path');
const QA = path.join(__dirname);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Login to the SPA dashboard
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);

  // Click "כניסה למערכת" (enter system) button
  const loginBtn = page.locator('text=כניסה למערכת');
  if (await loginBtn.isVisible()) {
    await loginBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(QA, '02-login-page.png'), fullPage: true });
    console.log('Screenshot 2: login page');

    // Try logging in with a phone number
    const phoneInput = page.locator('input[type="tel"], input[placeholder*="phone"], input[placeholder*="טלפון"]');
    if (await phoneInput.count() > 0) {
      await phoneInput.first().fill('0559733329');
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(QA, '03-phone-entered.png'), fullPage: true });

      // Click the login/continue button
      const submitBtn = page.locator('button, [role="button"]').filter({ hasText: /כניסה|login|continue|המשך/ });
      if (await submitBtn.count() > 0) {
        await submitBtn.first().click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(QA, '04-after-login.png'), fullPage: true });
        console.log('Screenshot 4: after login');
      }
    }
  }

  // Check current URL and content
  console.log('URL:', page.url());
  const text = await page.textContent('body');
  console.log('Body text (300):', text?.substring(0, 300));

  // Try navigating directly to appointments
  await page.goto('http://localhost:3000/appointments', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(QA, '05-appointments.png'), fullPage: true });
  console.log('Screenshot 5: appointments page');

  await browser.close();
  console.log('Done');
})();
