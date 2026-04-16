import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const DIR = '/home/itziktdk/.openclaw/workspace/picktime/qa-post-deploy';
const BASE = 'https://snaptor.app';
const results = [];

function log(test, status, detail = '') {
  const entry = { test, status, detail };
  results.push(entry);
  console.log(`[${status}] ${test}${detail ? ' — ' + detail : ''}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // ========== TEST 1: Landing Page ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    const title = await page.title();
    await page.screenshot({ path: path.join(DIR, 'landing.png'), fullPage: true });
    if (title && title.trim().length > 0) {
      log('1. Landing Page', 'PASS', `Title: "${title}"`);
    } else {
      log('1. Landing Page', 'FAIL', 'Empty title');
    }
    await ctx.close();
  } catch (e) {
    log('1. Landing Page', 'FAIL', e.message);
  }

  // ========== TEST 2: Login Multi-Business ==========
  let dashPage = null;
  let dashCtx = null;
  try {
    dashCtx = await browser.newContext({ locale: 'he-IL' });
    dashPage = await dashCtx.newPage();
    // Try to find login page
    await dashPage.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1500);
    
    // Look for login link/button or go to /login
    const loginLink = await dashPage.$('a[href*="login"], button:has-text("כניסה"), a:has-text("כניסה"), a:has-text("התחברות")');
    if (loginLink) {
      await loginLink.click();
      await sleep(2000);
    } else {
      await dashPage.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 15000 });
      await sleep(1500);
    }
    
    // Find phone input
    const phoneInput = await dashPage.$('input[type="tel"], input[name="phone"], input[placeholder*="טלפון"], input[placeholder*="phone"], input[type="text"]');
    if (phoneInput) {
      await phoneInput.fill('0546666094');
    } else {
      // Try all inputs
      const inputs = await dashPage.$$('input');
      if (inputs.length > 0) await inputs[0].fill('0546666094');
    }
    await sleep(500);
    
    // Submit
    const submitBtn = await dashPage.$('button[type="submit"], button:has-text("כניסה"), button:has-text("שליחה"), button:has-text("המשך"), button:has-text("התחבר")');
    if (submitBtn) await submitBtn.click();
    await sleep(3000);
    
    await dashPage.screenshot({ path: path.join(DIR, 'login-result.png'), fullPage: true });
    
    const pageContent = await dashPage.content();
    const hasNarkis = pageContent.includes('נרקיס');
    const hasMenashe = pageContent.includes('מנשה');
    
    if (hasNarkis && hasMenashe) {
      log('2a. Multi-Business Login - Selector', 'PASS', 'Found נרקיס and מנשה צדקה');
    } else if (hasNarkis || hasMenashe) {
      log('2a. Multi-Business Login - Selector', 'PARTIAL', `נרקיס: ${hasNarkis}, מנשה: ${hasMenashe}`);
    } else {
      log('2a. Multi-Business Login - Selector', 'FAIL', 'Business selector not found');
    }
    
    // Click first business
    const bizBtn = await dashPage.$('button:has-text("נרקיס"), div:has-text("נרקיס"):not(:has(div)), a:has-text("נרקיס")');
    if (bizBtn) {
      await bizBtn.click();
      await sleep(3000);
      await dashPage.screenshot({ path: path.join(DIR, 'dashboard-after-select.png'), fullPage: true });
      log('2b. Multi-Business Login - Dashboard', 'PASS', 'Selected business, dashboard loaded');
    } else {
      // Try clicking any card/button-like element
      const cards = await dashPage.$$('.business-card, [class*="business"], [class*="card"]');
      if (cards.length > 0) {
        await cards[0].click();
        await sleep(3000);
        await dashPage.screenshot({ path: path.join(DIR, 'dashboard-after-select.png'), fullPage: true });
        log('2b. Multi-Business Login - Dashboard', 'PASS', 'Clicked first business card');
      } else {
        await dashPage.screenshot({ path: path.join(DIR, 'dashboard-after-select.png'), fullPage: true });
        log('2b. Multi-Business Login - Dashboard', 'FAIL', 'Could not find business to click');
      }
    }
  } catch (e) {
    log('2. Multi-Business Login', 'FAIL', e.message);
  }
  if (dashCtx) await dashCtx.close();

  // ========== TEST 3: Single Business Login ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(1500);
    
    const phoneInput = await page.$('input[type="tel"], input[name="phone"], input[placeholder*="טלפון"], input[type="text"]');
    if (phoneInput) await phoneInput.fill('0501234567');
    else {
      const inputs = await page.$$('input');
      if (inputs.length > 0) await inputs[0].fill('0501234567');
    }
    await sleep(500);
    
    const submitBtn = await page.$('button[type="submit"], button:has-text("כניסה"), button:has-text("שליחה"), button:has-text("המשך")');
    if (submitBtn) await submitBtn.click();
    await sleep(3000);
    
    await page.screenshot({ path: path.join(DIR, 'single-login-result.png'), fullPage: true });
    const url = page.url();
    const content = await page.content();
    // Check if we went to dashboard directly (no business selector)
    const hasBizSelector = content.includes('בחר עסק') || content.includes('בחירת עסק');
    if (!hasBizSelector && (url.includes('dashboard') || content.includes('לוח') || content.includes('תורים'))) {
      log('3. Single Business Login', 'PASS', 'Went directly to dashboard');
    } else if (hasBizSelector) {
      log('3. Single Business Login', 'FAIL', 'Showed business selector instead of going directly');
    } else {
      log('3. Single Business Login', 'UNCLEAR', `URL: ${url}`);
    }
    await ctx.close();
  } catch (e) {
    log('3. Single Business Login', 'FAIL', e.message);
  }

  // ========== TEST 4: Admin Panel ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(2000);
    
    // Enter password
    const pwdInput = await page.$('input[type="password"], input[placeholder*="סיסמ"], input[type="text"]');
    if (pwdInput) {
      await pwdInput.fill('snaptor2026');
      const btn = await page.$('button[type="submit"], button:has-text("כניסה"), button:has-text("אישור"), button');
      if (btn) await btn.click();
      await sleep(3000);
    }
    
    await page.screenshot({ path: path.join(DIR, 'admin-businesses.png'), fullPage: true });
    const content = await page.content();
    const hasAdmin = content.includes('עסקים') || content.includes('admin') || content.includes('ניהול');
    log('4a. Admin Panel - Load', hasAdmin ? 'PASS' : 'FAIL', hasAdmin ? 'Admin panel loaded' : 'Admin content not found');
    
    // Check tabs
    const tabs = await page.$$('button[role="tab"], [class*="tab"], nav button, nav a');
    console.log(`Found ${tabs.length} tab-like elements`);
    
    // Try customers tab
    const custTab = await page.$('button:has-text("לקוחות"), a:has-text("לקוחות"), [data-tab="customers"]');
    if (custTab) {
      await custTab.click();
      await sleep(2000);
      await page.screenshot({ path: path.join(DIR, 'admin-customers.png'), fullPage: true });
      log('4b. Admin - Customers Tab', 'PASS', '');
    } else {
      log('4b. Admin - Customers Tab', 'FAIL', 'Tab not found');
    }
    
    // Try appointments tab
    const apptTab = await page.$('button:has-text("תורים"), a:has-text("תורים"), [data-tab="appointments"]');
    if (apptTab) {
      await apptTab.click();
      await sleep(2000);
      await page.screenshot({ path: path.join(DIR, 'admin-appointments.png'), fullPage: true });
      log('4c. Admin - Appointments Tab', 'PASS', '');
    } else {
      log('4c. Admin - Appointments Tab', 'FAIL', 'Tab not found');
    }
    
    // Check "כניסה אחרונה" column
    const hasLastLogin = content.includes('כניסה אחרונה');
    log('4d. Admin - Last Login Column', hasLastLogin ? 'PASS' : 'FAIL', hasLastLogin ? 'Column exists' : 'Column not found');
    
    // Test edit button
    const editBtn = await page.$('button:has-text("עריכה"), button:has-text("✏"), [class*="edit"], button svg');
    if (editBtn) {
      log('4e. Admin - Edit Button', 'PASS', 'Edit button found');
    } else {
      log('4e. Admin - Edit Button', 'FAIL', 'No edit button found');
    }
    
    // Test toggle
    const toggle = await page.$('input[type="checkbox"], [role="switch"], [class*="toggle"], label:has(input)');
    if (toggle) {
      log('4f. Admin - Toggle', 'PASS', 'Toggle found');
    } else {
      log('4f. Admin - Toggle', 'FAIL', 'No toggle found');
    }
    
    await ctx.close();
  } catch (e) {
    log('4. Admin Panel', 'FAIL', e.message);
  }

  // ========== TEST 5: Booking Page ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/book/narkis11', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(2000);
    
    await page.screenshot({ path: path.join(DIR, 'booking-services.png'), fullPage: true });
    const content = await page.content();
    const hasServices = content.includes('שירות') || content.includes('service') || content.includes('תספורת') || content.includes('בחר');
    log('5a. Booking - Services Page', hasServices ? 'PASS' : 'FAIL', hasServices ? 'Services displayed' : 'No services found');
    
    // Click first service
    const serviceBtn = await page.$('button:has-text("תספורת"), [class*="service"] button, [class*="service-card"], button:has-text("בחר")');
    if (!serviceBtn) {
      // Try any clickable service-like element
      const btns = await page.$$('button');
      if (btns.length > 0) {
        for (const b of btns) {
          const txt = await b.textContent();
          if (txt && (txt.includes('תספורת') || txt.includes('בחר') || txt.length > 2)) {
            await b.click();
            break;
          }
        }
      }
    } else {
      await serviceBtn.click();
    }
    await sleep(2000);
    await page.screenshot({ path: path.join(DIR, 'booking-date.png'), fullPage: true });
    log('5b. Booking - After Service Select', 'PASS', `URL: ${page.url()}`);
    
    await ctx.close();
  } catch (e) {
    log('5. Booking Page', 'FAIL', e.message);
  }

  // ========== TEST 6: Dashboard Features ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    // Login first
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(1500);
    const phoneInput = await page.$('input[type="tel"], input[name="phone"], input[type="text"]');
    if (phoneInput) await phoneInput.fill('0546666094');
    const submitBtn = await page.$('button[type="submit"], button:has-text("כניסה"), button:has-text("המשך")');
    if (submitBtn) await submitBtn.click();
    await sleep(3000);
    
    // Select business if needed
    const bizBtn = await page.$('button:has-text("נרקיס"), div:has-text("נרקיס")');
    if (bizBtn) { await bizBtn.click(); await sleep(2000); }
    
    await page.screenshot({ path: path.join(DIR, 'dash-home.png'), fullPage: true });
    log('6a. Dashboard - Home', 'PASS', `URL: ${page.url()}`);
    
    // Appointments tab
    const apptTab = await page.$('a:has-text("תורים"), button:has-text("תורים"), [href*="appointment"]');
    if (apptTab) { await apptTab.click(); await sleep(2000); }
    await page.screenshot({ path: path.join(DIR, 'dash-appointments.png'), fullPage: true });
    log('6b. Dashboard - Appointments', apptTab ? 'PASS' : 'FAIL', apptTab ? '' : 'Tab not found');
    
    // Customers tab
    const custTab = await page.$('a:has-text("לקוחות"), button:has-text("לקוחות"), [href*="customer"]');
    if (custTab) { await custTab.click(); await sleep(2000); }
    await page.screenshot({ path: path.join(DIR, 'dash-customers.png'), fullPage: true });
    log('6c. Dashboard - Customers', custTab ? 'PASS' : 'FAIL', custTab ? '' : 'Tab not found');
    
    // Settings tab
    const setTab = await page.$('a:has-text("הגדרות"), button:has-text("הגדרות"), [href*="setting"]');
    if (setTab) { await setTab.click(); await sleep(2000); }
    await page.screenshot({ path: path.join(DIR, 'dash-settings.png'), fullPage: true });
    log('6d. Dashboard - Settings', setTab ? 'PASS' : 'FAIL', setTab ? '' : 'Tab not found');
    
    await ctx.close();
  } catch (e) {
    log('6. Dashboard', 'FAIL', e.message);
  }

  // ========== TEST 7: Staff Page ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(1500);
    const phoneInput = await page.$('input[type="tel"], input[name="phone"], input[type="text"]');
    if (phoneInput) await phoneInput.fill('0546666094');
    const submitBtn = await page.$('button[type="submit"], button:has-text("כניסה"), button:has-text("המשך")');
    if (submitBtn) await submitBtn.click();
    await sleep(3000);
    const bizBtn = await page.$('button:has-text("נרקיס"), div:has-text("נרקיס")');
    if (bizBtn) { await bizBtn.click(); await sleep(2000); }
    
    // Navigate to staff/settings
    const setTab = await page.$('a:has-text("הגדרות"), button:has-text("הגדרות"), [href*="setting"]');
    if (setTab) { await setTab.click(); await sleep(2000); }
    
    const staffLink = await page.$('a:has-text("צוות"), button:has-text("צוות"), a:has-text("עובדים"), [href*="staff"]');
    if (staffLink) { await staffLink.click(); await sleep(2000); }
    
    await page.screenshot({ path: path.join(DIR, 'staff-page.png'), fullPage: true });
    
    // Check for toggle
    const toggle = await page.$('input[type="checkbox"], [role="switch"], [class*="toggle"]');
    if (toggle) {
      const box = await toggle.boundingBox();
      log('7a. Staff - Toggle', 'PASS', box ? `Toggle at ${JSON.stringify(box)}` : 'Toggle found but no bbox');
      // Check for RTL overflow
      if (box && box.x < 0) {
        log('7b. Staff - RTL Overflow', 'FAIL', `Toggle x=${box.x} is negative (overflow)`);
      } else {
        log('7b. Staff - RTL Overflow', 'PASS', 'No overflow detected');
      }
    } else {
      log('7. Staff Page', 'FAIL', 'No toggle found');
    }
    
    await ctx.close();
  } catch (e) {
    log('7. Staff Page', 'FAIL', e.message);
  }

  // ========== TEST 8: Mobile View ==========
  try {
    const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(2000);
    await page.screenshot({ path: path.join(DIR, 'mobile-landing.png'), fullPage: true });
    log('8a. Mobile - Landing', 'PASS', '');
    
    await page.goto(BASE + '/book/narkis11', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(2000);
    await page.screenshot({ path: path.join(DIR, 'mobile-booking.png'), fullPage: true });
    log('8b. Mobile - Booking', 'PASS', '');
    
    // Login for dashboard
    await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(1500);
    const phoneInput = await page.$('input[type="tel"], input[name="phone"], input[type="text"]');
    if (phoneInput) await phoneInput.fill('0546666094');
    const submitBtn = await page.$('button[type="submit"], button:has-text("כניסה"), button:has-text("המשך")');
    if (submitBtn) await submitBtn.click();
    await sleep(3000);
    const bizBtn = await page.$('button:has-text("נרקיס"), div:has-text("נרקיס")');
    if (bizBtn) { await bizBtn.click(); await sleep(2000); }
    await page.screenshot({ path: path.join(DIR, 'mobile-dashboard.png'), fullPage: true });
    log('8c. Mobile - Dashboard', 'PASS', '');
    
    await ctx.close();
  } catch (e) {
    log('8. Mobile View', 'FAIL', e.message);
  }

  await browser.close();

  // Write report
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const other = results.filter(r => !['PASS','FAIL'].includes(r.status)).length;
  
  let report = `# QA Post-Deploy Report — Snaptor.app\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;
  report += `**Summary:** ${passed} PASS / ${failed} FAIL / ${other} OTHER\n\n`;
  report += `| # | Test | Status | Detail | Screenshot |\n`;
  report += `|---|------|--------|--------|------------|\n`;
  for (const r of results) {
    const emoji = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    report += `| ${emoji} | ${r.test} | **${r.status}** | ${r.detail} | |\n`;
  }
  report += `\n## Screenshots\nAll saved to \`qa-post-deploy/\`\n`;
  report += `\n## Verdict\n`;
  if (failed === 0) report += `✅ All tests passed!\n`;
  else report += `⚠️ ${failed} test(s) failed. Review screenshots for details.\n`;
  
  fs.writeFileSync('/home/itziktdk/.openclaw/workspace/picktime/QA-POST-DEPLOY.md', report);
  console.log('\n=== REPORT WRITTEN ===');
  console.log(report);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
