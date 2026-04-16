const { chromium } = require('playwright');
const path = require('path');
const QA = '/home/itziktdk/.openclaw/workspace/picktime/qa-fab';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // Go to the SPA root (should show login)
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(QA, '01-spa-root.png'), fullPage: true });
  console.log('Screenshot 1: SPA root');

  // Try navigating to a known slug if we can find one
  // First check the login page
  const bodyText = await page.textContent('body');
  console.log('Page text (first 300):', bodyText?.substring(0, 300));

  await browser.close();
  console.log('Done');
})();
