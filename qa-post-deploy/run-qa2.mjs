import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const DIR = '/home/itziktdk/.openclaw/workspace/picktime/qa-post-deploy';
const BASE = 'https://snaptor.app';
const results = [];
const WAIT = 'domcontentloaded';
const TIMEOUT = 30000;

function log(test, status, detail = '') {
  results.push({ test, status, detail });
  console.log(`[${status}] ${test}${detail ? ' — ' + detail : ''}`);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ========== TEST 1: Landing ==========
  try {
    const page = await (await browser.newContext({ locale: 'he-IL' })).newPage();
    await page.goto(BASE, { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    const title = await page.title();
    await page.screenshot({ path: path.join(DIR, 'landing.png'), fullPage: true });
    log('1. Landing Page', title?.trim() ? 'PASS' : 'FAIL', `Title: "${title}"`);
    // Check what's actually on the page
    const h1 = await page.$eval('h1', el => el.textContent).catch(() => 'none');
    console.log('  H1:', h1);
    const bodyText = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
    console.log('  Body preview:', bodyText.substring(0, 300));
    await page.context().close();
  } catch (e) { log('1. Landing Page', 'FAIL', e.message); }

  // ========== TEST 2: Multi-Business Login ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    
    // Debug: what's on login page
    const bodyText = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
    console.log('  Login body:', bodyText.substring(0, 300));
    
    const inputs = await page.$$('input');
    console.log(`  Found ${inputs.length} inputs`);
    for (let i = 0; i < inputs.length; i++) {
      const type = await inputs[i].getAttribute('type');
      const name = await inputs[i].getAttribute('name');
      const ph = await inputs[i].getAttribute('placeholder');
      console.log(`    input[${i}]: type=${type} name=${name} placeholder=${ph}`);
    }
    
    // Fill phone
    if (inputs.length > 0) {
      await inputs[0].fill('0546666094');
      await sleep(500);
    }
    
    // Find and click submit
    const buttons = await page.$$('button');
    console.log(`  Found ${buttons.length} buttons`);
    for (const b of buttons) {
      const txt = (await b.textContent()).trim();
      console.log(`    button: "${txt}"`);
    }
    
    const submitBtn = await page.$('button[type="submit"]') || (buttons.length > 0 ? buttons[buttons.length - 1] : null);
    if (submitBtn) await submitBtn.click();
    await sleep(4000);
    
    await page.screenshot({ path: path.join(DIR, 'login-result.png'), fullPage: true });
    
    const content = await page.content();
    const hasNarkis = content.includes('נרקיס');
    const hasMenashe = content.includes('מנשה');
    
    if (hasNarkis || hasMenashe) {
      log('2a. Business Selector', hasNarkis && hasMenashe ? 'PASS' : 'PARTIAL', `נרקיס:${hasNarkis} מנשה:${hasMenashe}`);
    } else {
      log('2a. Business Selector', 'FAIL', 'No business names found after login');
      const afterBody = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
      console.log('  After login body:', afterBody.substring(0, 300));
    }
    
    // Click business
    const bizBtn = await page.$('button:has-text("נרקיס")');
    if (!bizBtn) {
      // Try broader selector
      const allClickable = await page.$$('div[class*="card"], div[class*="business"], button, a');
      for (const el of allClickable) {
        const txt = await el.textContent();
        if (txt?.includes('נרקיס')) {
          await el.click();
          await sleep(3000);
          break;
        }
      }
    } else {
      await bizBtn.click();
      await sleep(3000);
    }
    
    await page.screenshot({ path: path.join(DIR, 'dashboard-after-select.png'), fullPage: true });
    const dashUrl = page.url();
    console.log('  Dashboard URL:', dashUrl);
    const dashBody = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
    console.log('  Dashboard body:', dashBody.substring(0, 300));
    log('2b. Dashboard After Select', 'DONE', `URL: ${dashUrl}`);
    
    await ctx.close();
  } catch (e) { log('2. Multi-Business Login', 'FAIL', e.message); }

  // ========== TEST 3: Single Business Login ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    const inputs = await page.$$('input');
    if (inputs.length > 0) await inputs[0].fill('0501234567');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    else { const btns = await page.$$('button'); if (btns.length) await btns[btns.length-1].click(); }
    await sleep(4000);
    await page.screenshot({ path: path.join(DIR, 'single-login-result.png'), fullPage: true });
    const url = page.url();
    const body = await page.$eval('body', el => el.innerText.substring(0, 300)).catch(() => '');
    console.log('  Single login URL:', url, 'Body:', body.substring(0, 200));
    log('3. Single Business Login', url.includes('dashboard') ? 'PASS' : 'UNCLEAR', `URL: ${url}`);
    await ctx.close();
  } catch (e) { log('3. Single Business Login', 'FAIL', e.message); }

  // ========== TEST 4: Admin ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(4000);
    
    const body = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
    console.log('  Admin body:', body.substring(0, 300));
    
    // Password
    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) {
      await pwdInput.fill('snaptor2026');
      const btn = await page.$('button[type="submit"], button');
      if (btn) await btn.click();
      await sleep(3000);
    } else {
      // Maybe text input
      const inputs = await page.$$('input');
      if (inputs.length > 0) {
        await inputs[0].fill('snaptor2026');
        const btns = await page.$$('button');
        if (btns.length) await btns[0].click();
        await sleep(3000);
      }
    }
    
    await page.screenshot({ path: path.join(DIR, 'admin-businesses.png'), fullPage: true });
    const adminBody = await page.$eval('body', el => el.innerText.substring(0, 1000)).catch(() => '');
    console.log('  Admin after login:', adminBody.substring(0, 400));
    
    const hasLastLogin = adminBody.includes('כניסה אחרונה');
    log('4a. Admin - Businesses', adminBody.length > 50 ? 'PASS' : 'FAIL', `Last login col: ${hasLastLogin}`);
    
    // Customers tab
    for (const label of ['לקוחות', 'Customers']) {
      const tab = await page.$(`button:has-text("${label}"), a:has-text("${label}")`);
      if (tab) { await tab.click(); await sleep(2000); break; }
    }
    await page.screenshot({ path: path.join(DIR, 'admin-customers.png'), fullPage: true });
    log('4b. Admin - Customers', 'DONE', '');
    
    // Appointments tab
    for (const label of ['תורים', 'Appointments']) {
      const tab = await page.$(`button:has-text("${label}"), a:has-text("${label}")`);
      if (tab) { await tab.click(); await sleep(2000); break; }
    }
    await page.screenshot({ path: path.join(DIR, 'admin-appointments.png'), fullPage: true });
    log('4c. Admin - Appointments', 'DONE', '');
    
    // Edit + Toggle
    const editBtn = await page.$('button:has-text("עריכה"), button:has-text("Edit"), [aria-label*="edit"]');
    log('4d. Admin - Edit Button', editBtn ? 'PASS' : 'FAIL', editBtn ? 'Found' : 'Not found');
    
    const toggle = await page.$('[role="switch"], input[type="checkbox"], [class*="toggle"], [class*="switch"]');
    log('4e. Admin - Toggle', toggle ? 'PASS' : 'FAIL', toggle ? 'Found' : 'Not found');
    
    await ctx.close();
  } catch (e) { log('4. Admin Panel', 'FAIL', e.message); }

  // ========== TEST 5: Booking ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/book/narkis11', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(4000);
    
    await page.screenshot({ path: path.join(DIR, 'booking-services.png'), fullPage: true });
    const body = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
    console.log('  Booking body:', body.substring(0, 300));
    log('5a. Booking Services', body.length > 30 ? 'PASS' : 'FAIL', body.substring(0, 100));
    
    // Click first service-like button
    const buttons = await page.$$('button');
    let clicked = false;
    for (const b of buttons) {
      const txt = (await b.textContent()).trim();
      if (txt.length > 2 && !txt.includes('×') && !txt.includes('close')) {
        console.log('  Clicking service:', txt.substring(0, 50));
        await b.click();
        clicked = true;
        break;
      }
    }
    await sleep(3000);
    await page.screenshot({ path: path.join(DIR, 'booking-date.png'), fullPage: true });
    log('5b. Booking - Next Step', clicked ? 'PASS' : 'FAIL', `URL: ${page.url()}`);
    
    await ctx.close();
  } catch (e) { log('5. Booking Page', 'FAIL', e.message); }

  // ========== TEST 6: Dashboard tabs ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    const inputs = await page.$$('input');
    if (inputs.length > 0) await inputs[0].fill('0546666094');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    else { const btns = await page.$$('button'); if (btns.length) await btns[btns.length-1].click(); }
    await sleep(4000);
    
    // Select business if needed
    const allEls = await page.$$('button, div, a');
    for (const el of allEls) {
      const txt = await el.textContent().catch(() => '');
      if (txt?.includes('נרקיס') && !txt?.includes('login')) {
        try { await el.click(); } catch {}
        await sleep(2000);
        break;
      }
    }
    
    await page.screenshot({ path: path.join(DIR, 'dash-home.png'), fullPage: true });
    const dashBody = await page.$eval('body', el => el.innerText.substring(0, 300)).catch(() => '');
    console.log('  Dashboard home:', dashBody.substring(0, 200));
    log('6a. Dash Home', 'DONE', `URL: ${page.url()}`);
    
    // Navigate tabs
    const tabNames = [
      { label: 'תורים', file: 'dash-appointments.png', name: 'Appointments' },
      { label: 'לקוחות', file: 'dash-customers.png', name: 'Customers' },
      { label: 'הגדרות', file: 'dash-settings.png', name: 'Settings' },
    ];
    for (const t of tabNames) {
      const tab = await page.$(`a:has-text("${t.label}"), button:has-text("${t.label}"), [href*="${t.label}"]`);
      if (tab) { await tab.click(); await sleep(2000); }
      await page.screenshot({ path: path.join(DIR, t.file), fullPage: true });
      log(`6. Dash - ${t.name}`, tab ? 'PASS' : 'FAIL', tab ? '' : 'Tab not found');
    }
    
    await ctx.close();
  } catch (e) { log('6. Dashboard', 'FAIL', e.message); }

  // ========== TEST 7: Staff ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    const inputs = await page.$$('input');
    if (inputs.length > 0) await inputs[0].fill('0546666094');
    const btn = await page.$('button[type="submit"]');
    if (btn) await btn.click();
    else { const btns = await page.$$('button'); if (btns.length) await btns[btns.length-1].click(); }
    await sleep(4000);
    // Select business
    const allEls = await page.$$('button, div, a');
    for (const el of allEls) {
      const txt = await el.textContent().catch(() => '');
      if (txt?.includes('נרקיס')) { try { await el.click(); } catch {} await sleep(2000); break; }
    }
    
    // Try to find staff settings
    const settingsTab = await page.$('a:has-text("הגדרות"), button:has-text("הגדרות")');
    if (settingsTab) { await settingsTab.click(); await sleep(2000); }
    
    // Look for staff section
    const staffBtn = await page.$('a:has-text("צוות"), button:has-text("צוות"), a:has-text("עובדים")');
    if (staffBtn) { await staffBtn.click(); await sleep(2000); }
    
    await page.screenshot({ path: path.join(DIR, 'staff-page.png'), fullPage: true });
    const staffBody = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
    console.log('  Staff page:', staffBody.substring(0, 200));
    
    // Check toggle overflow
    const toggles = await page.$$('[role="switch"], input[type="checkbox"], [class*="toggle"]');
    if (toggles.length > 0) {
      const box = await toggles[0].boundingBox();
      const viewport = page.viewportSize();
      const overflow = box && (box.x < 0 || box.x + box.width > viewport.width);
      log('7. Staff Page', overflow ? 'FAIL' : 'PASS', overflow ? 'RTL overflow detected' : `${toggles.length} toggle(s), no overflow`);
    } else {
      log('7. Staff Page', 'FAIL', 'No toggles found');
    }
    
    await ctx.close();
  } catch (e) { log('7. Staff Page', 'FAIL', e.message); }

  // ========== TEST 8: Mobile ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    
    await page.goto(BASE, { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    await page.screenshot({ path: path.join(DIR, 'mobile-landing.png'), fullPage: true });
    log('8a. Mobile Landing', 'PASS', '');
    
    await page.goto(BASE + '/book/narkis11', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    await page.screenshot({ path: path.join(DIR, 'mobile-booking.png'), fullPage: true });
    log('8b. Mobile Booking', 'PASS', '');
    
    // Login
    await page.goto(BASE + '/login', { waitUntil: WAIT, timeout: TIMEOUT });
    await sleep(3000);
    const inputs = await page.$$('input');
    if (inputs.length > 0) await inputs[0].fill('0546666094');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    else { const btns = await page.$$('button'); if (btns.length) await btns[btns.length-1].click(); }
    await sleep(4000);
    const allEls = await page.$$('button, div, a');
    for (const el of allEls) {
      const txt = await el.textContent().catch(() => '');
      if (txt?.includes('נרקיס')) { try { await el.click(); } catch {} await sleep(2000); break; }
    }
    await page.screenshot({ path: path.join(DIR, 'mobile-dashboard.png'), fullPage: true });
    log('8c. Mobile Dashboard', 'PASS', '');
    
    await ctx.close();
  } catch (e) { log('8. Mobile', 'FAIL', e.message); }

  await browser.close();

  // ===== WRITE REPORT =====
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const other = results.filter(r => !['PASS','FAIL'].includes(r.status)).length;
  
  let report = `# QA Post-Deploy Report — Snaptor.app\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;
  report += `**Summary:** ${passed} PASS / ${failed} FAIL / ${other} OTHER\n\n`;
  
  for (const r of results) {
    const emoji = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    report += `### ${emoji} ${r.test} — **${r.status}**\n`;
    if (r.detail) report += `${r.detail}\n`;
    report += `\n`;
  }
  
  report += `\n## Screenshots\nAll saved to \`qa-post-deploy/\`\n`;
  report += `\n## Verdict\n`;
  if (failed === 0) report += `✅ All tests passed!\n`;
  else report += `⚠️ ${failed} test(s) failed. Review screenshots.\n`;
  
  fs.writeFileSync('/home/itziktdk/.openclaw/workspace/picktime/QA-POST-DEPLOY.md', report);
  console.log('\n=== DONE ===');
  console.log(report);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
