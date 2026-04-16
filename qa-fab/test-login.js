const { chromium } = require('playwright');
const path = require('path');
const QA = path.join(__dirname);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Go to login
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);

  // Find and fill the phone input
  const inputs = page.locator('input');
  const count = await inputs.count();
  console.log('Input count:', count);
  for (let i = 0; i < count; i++) {
    const ph = await inputs.nth(i).getAttribute('placeholder');
    const type = await inputs.nth(i).getAttribute('type');
    console.log(`Input ${i}: type=${type} placeholder=${ph}`);
  }

  // Fill the phone input (first one)
  if (count > 0) {
    await inputs.first().fill('0559733329');
    await page.waitForTimeout(500);

    // Click login button
    const btn = page.locator('div[role="button"], button').filter({ hasText: /התחברות|כניסה/ });
    console.log('Buttons found:', await btn.count());
    if (await btn.count() > 0) {
      await btn.first().click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: path.join(QA, '06-after-login.png'), fullPage: true });
      console.log('URL after login:', page.url());
    }
  }

  // Navigate to appointments tab
  const apptTab = page.locator('text=תורים');
  if (await apptTab.count() > 0) {
    await apptTab.first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(QA, '07-appointments-tab.png'), fullPage: true });
    console.log('Screenshot: appointments tab');
  }

  // Check for FAB
  const fab = page.locator('[style*="position: absolute"][style*="border-radius: 28"]');
  console.log('FAB found:', await fab.count());

  await browser.close();
  console.log('Done');
})();
