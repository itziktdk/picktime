const { chromium } = require('playwright');
const path = require('path');
const QA = path.join(__dirname, 'qa-final');
const BASE = 'https://snaptor.app';

(async () => {
  const browser = await chromium.launch();
  const results = [];

  async function go(page, url) {
    for (let i = 0; i < 3; i++) {
      try { await page.goto(url, { timeout: 40000, waitUntil: 'domcontentloaded' }); return true; } catch(e) { console.log(`  ⚠️ retry ${i+1}...`); await page.waitForTimeout(2000); }
    }
    return false;
  }
  async function ss(page, name) {
    try { await page.screenshot({ path: path.join(QA, name), fullPage: true, timeout: 10000 }); console.log(`  📸 ${name}`); } catch(e) {}
  }

  // Bug 0
  console.log('\n=== Bug 0: SPA Refresh ===');
  { const p = await browser.newPage(); if (await go(p, BASE)) { await p.waitForTimeout(2000); await p.evaluate(() => { window.location.href = '/dashboard'; }); await p.waitForTimeout(5000); const u = p.url(); console.log(`  URL: ${u}`); const pass = u.includes('/login') || u.includes('/dashboard'); console.log(`  ${pass?'✅':'❌'}`); results.push({bug:0,pass}); await ss(p,'bug0.png'); } else { results.push({bug:0,pass:false}); } await p.close(); }

  // Bug 1
  console.log('\n=== Bug 1: Login API ===');
  { const p = await browser.newPage(); const r = await p.request.post(`${BASE}/api/auth/login`,{data:{phone:'0501234567'}}); const j = await r.json(); const pass = j.exists && !!j.token && j.business?.slug==='test-barber'; console.log(`  token:${!!j.token} slug:${j.business?.slug}`); console.log(`  ${pass?'✅':'❌'}`); results.push({bug:1,pass}); await p.close(); }

  // Bug 1b
  console.log('\n=== Bug 1b: Auth Dashboard ===');
  { const p = await browser.newPage(); const r = await p.request.post(`${BASE}/api/auth/login`,{data:{phone:'0501234567'}}); const{token}=await r.json(); if(await go(p,BASE)){await p.waitForTimeout(1000); await p.evaluate(t=>localStorage.setItem('snaptor_token',t),token); await p.evaluate(()=>{window.location.href='/dashboard';}); await p.waitForTimeout(5000); const u=p.url(); console.log(`  URL:${u}`); const pass=!u.includes('/login'); console.log(`  ${pass?'✅':'❌'}`); results.push({bug:'1b',pass}); await ss(p,'bug1b.png');} else {results.push({bug:'1b',pass:false});} await p.close(); }

  // Bug 2
  console.log('\n=== Bug 2: Staff Persist ===');
  { const p = await browser.newPage(); const lr = await p.request.post(`${BASE}/api/auth/login`,{data:{phone:'0501234567'}}); const{token}=await lr.json(); const sr = await p.request.put(`${BASE}/api/businesses/test-barber/staff`,{headers:{Authorization:`Bearer ${token}`},data:{staff:[{name:'QA Staff',role:'Barber',isActive:true,services:[],workingDays:[0,1,2,3,4]}]}}); console.log(`  Save:${sr.status()}`); const gr = await p.request.get(`${BASE}/api/businesses/test-barber/staff`); const l = await gr.json(); const pass = Array.isArray(l) && l.length>0 && l[0].name==='QA Staff'; console.log(`  Count:${l.length} Name:${l[0]?.name}`); console.log(`  ${pass?'✅':'❌'}`); results.push({bug:2,pass}); await p.close(); }

  // Bug 4
  console.log('\n=== Bug 4: Admin ===');
  { const p = await browser.newPage(); if(await go(p,`${BASE}/admin`)){await p.waitForTimeout(2000); const c=await p.content(); const pass=(c.includes('editBusiness')||c.includes('עריכה'))&&(c.includes('toggle'))&&(c.includes('כניסה אחרונה')||c.includes('lastLogin')); console.log(`  ${pass?'✅':'❌'}`); results.push({bug:4,pass}); await ss(p,'bug4.png');} else {results.push({bug:4,pass:false});} await p.close(); }

  // Bug 5
  console.log('\n=== Bug 5: Title ===');
  { const p = await browser.newPage(); if(await go(p,BASE)){await p.waitForTimeout(3000); const t=await p.title(); console.log(`  Title:"${t}"`); const pass=t.length>0; console.log(`  ${pass?'✅':'❌'}`); results.push({bug:5,pass}); await ss(p,'bug5.png');} else {results.push({bug:5,pass:false});} await p.close(); }

  console.log('\n=== SUMMARY ===');
  results.forEach(r => console.log(`  Bug ${r.bug}: ${r.pass ? '✅' : '❌'}`));
  console.log(`  ${results.filter(r=>r.pass).length}/${results.length} passed`);
  await browser.close();
})();
