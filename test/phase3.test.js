'use strict';
// Phase 3 round 1: text storage (M-2), Mongo-backed limits (M-12), static hygiene (L-14),
// compression/caching (M-21), phone rules, .ics download.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, createBusiness, publicBook, fakePhone, daysFromToday, T, TZ } = require('./helpers');

let ctx;
before(async () => { ctx = await setup({ BOOKING_RATE_LIMIT: '3' }); });
after(async () => { await ctx.teardown(); });

const ownerBook = async (b, body) => {
  const r = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth)
    .send({ customerName: 'QA Test Owner', customerPhone: '0500000990', serviceId: String(b.business.services[0]._id), ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};

describe('M-2 text is stored as typed', () => {
  test("quotes and & survive; tags are stripped; legacy entities are decoded on read", async () => {
    const b = await createBusiness(ctx.api, { name: `QA Test O'Brien & Co "Studio" <b>bold</b>` });
    assert.equal(b.business.name, `QA Test O'Brien & Co "Studio" bold`);
    const raw = await ctx.db.collection('businesses').findOne({ slug: b.slug });
    assert.equal(raw.name, `QA Test O'Brien & Co "Studio" bold`, 'stored raw, not entity-encoded');
    const upd = await ctx.api.put(`/api/businesses/${b.slug}`).set(b.auth).send({ name: 'QA Test Tom & Jerry\'s' });
    assert.equal(upd.body.name, "QA Test Tom & Jerry's");
    // a record written by the old sanitizer
    await ctx.db.collection('businesses').updateOne({ slug: b.slug }, { $set: { name: 'QA Test O&#39;Brien &amp; Co &quot;x&quot;' } });
    const pub = await ctx.api.get(`/api/businesses/${b.slug}`);
    assert.equal(pub.body.name, `QA Test O'Brien & Co "x"`);
    await ctx.db.collection('businesses').updateOne({ slug: b.slug }, { $set: { name: 'QA Test &lt;script&gt;x' } });
    assert.equal((await ctx.api.get(`/api/businesses/${b.slug}`)).body.name, 'QA Test scriptx', 'decoding never yields markup');
  });

  test('legacy admin/book pages escape quotes in esc()', () => {
    for (const f of ['admin.html', 'book.html']) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      const m = html.match(/function esc\(s\) \{[^\n]*\}/);
      assert.ok(m, f);
      // eslint-disable-next-line no-new-func
      const esc = new Function(`${m[0]}; return esc;`)();
      assert.equal(esc(`a"b'c<d>&\``), 'a&quot;b&#39;c&lt;d&gt;&amp;&#96;', f);
    }
    const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    assert.ok(!/openDelete\('\$\{b\._id\}',`\$\{esc\(b\.name\)\}`\)/.test(admin), 'no business name inside inline JS');
  });
});

describe('phone rules (phase 3)', () => {
  test('generic update cannot change the phone; shared numbers need acknowledgement and then log in to both', async () => {
    const a = await createBusiness(ctx.api);
    const b = await createBusiness(ctx.api);
    const put = await ctx.api.put(`/api/businesses/${a.slug}`).set(a.auth).send({ phone: fakePhone() });
    assert.equal(put.status, 400); assert.equal(put.body.code, 'phone_change_route');
    const same = await ctx.api.put(`/api/businesses/${a.slug}`).set(a.auth).send({ phone: a.business.phone, email: 'qa@example.com' });
    assert.equal(same.status, 200);
    const post = (body) => ctx.api.post(`/api/businesses/${a.slug}/phone`).set(a.auth).send(body);
    const shared = await post({ phone: b.business.phone });
    assert.equal(shared.status, 409); assert.equal(shared.body.code, 'phone_shared'); assert.equal(shared.body.businesses, 1);
    const ok = await post({ phone: b.business.phone, acknowledgeShared: true });
    assert.equal(ok.status, 200); assert.equal(ok.body.business.phone, b.business.phone);
    const login = await ctx.api.post('/api/auth/login').send({ phone: b.business.phone });
    assert.equal(login.status, 200);
    assert.equal((login.body.businesses || []).length, 2, JSON.stringify(login.body));
  });
});

describe('.ics download', () => {
  test('calendar file for a booking; cancelled → STATUS:CANCELLED; bad token → 404', async () => {
    const b = await createBusiness(ctx.api, { name: "QA Test Ics & Co's", address: 'הרצל 1, תל אביב' });
    const date = daysFromToday(3);
    const appt = await ownerBook(b, { date, startTime: '10:00' });
    const tok = appt.manageToken;
    assert.ok(tok, 'owner bookings get a manage link too');
    const r = await ctx.api.get(`/api/manage/${tok}/ics`);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/calendar/);
    assert.match(r.headers['content-disposition'], /attachment; filename="snaptor-.*\.ics"/);
    const body = r.text;
    assert.match(body, /BEGIN:VCALENDAR\r\n/);
    assert.match(body, /BEGIN:VEVENT/);
    const start = new Date(T.zonedTimeToUtcMs(date, '10:00', TZ)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    assert.ok(body.includes(`DTSTART:${start}`), body);
    assert.ok(body.includes("QA Test Ics & Co's"), 'decoded business name');
    assert.ok(body.includes('/manage/'), 'manage link in the event');
    assert.ok(body.includes('STATUS:CONFIRMED'));
    for (const line of body.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'folded: ' + line);
    await ctx.api.put(`/api/businesses/${b.slug}/appointments/${appt.id || appt._id}`).set(b.auth).send({ status: 'cancelled' });
    const c = await ctx.api.get(`/api/manage/${tok}/ics`);
    assert.ok(c.text.includes('STATUS:CANCELLED'));
    assert.equal((await ctx.api.get(`/api/manage/${tok.slice(0, -2)}xx/ics`)).status, 404);
  });
});

describe('L-14 / M-21 static hygiene', () => {
  test('robots, sitemap, manifest are real files', async () => {
    const r = await ctx.api.get('/robots.txt');
    assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/plain/);
    assert.match(r.text, /Disallow: \/api\//); assert.match(r.text, /Disallow: \/\*\/manage\//); assert.match(r.text, /Sitemap: /);
    const s = await ctx.api.get('/sitemap.xml');
    assert.equal(s.status, 200); assert.match(s.headers['content-type'], /xml/); assert.match(s.text, /<urlset/);
    const m = await ctx.api.get('/manifest.json');
    assert.equal(m.status, 200); assert.equal(JSON.parse(m.text).short_name, 'Snaptor');
  });

  test('server files and dotfiles are 404; stale exports redirect; missing assets 404; SPA routes still work', async () => {
    for (const p of ['/.env', '/.git/config', '/server.js', '/package.json', '/node_modules/express/package.json', '/lib/otp.js', '/missing-file.js', '/nope.png', '/wp-login.php']) {
      const r = await ctx.api.get(p);
      assert.equal(r.status, 404, p);
      assert.ok(!/<div id="root">/.test(r.text), p + ' must not return the SPA');
    }
    for (const [from, to] of [['/login.html', '/login'], ['/dashboard.html', '/dashboard'], ['/(auth)/register.html', '/register'], ['/[slug].html', '/'], ['/index.html', '/']]) {
      const r = await ctx.api.get(from);
      assert.equal(r.status, 301, from); assert.equal(r.headers.location, to, from);
    }
    assert.equal((await ctx.api.get('/admin.html')).status, 200, 'legacy admin page still served');
    for (const p of ['/', '/login', '/some-business', '/some-business/manage/abc']) {
      const r = await ctx.api.get(p);
      assert.equal(r.status, 200, p); assert.match(r.headers['cache-control'] || '', /no-cache/, p);
    }
  });

  test('bundles are compressed and immutable', async () => {
    const html = (await ctx.api.get('/')).text;
    const bundle = html.match(/\/_expo\/static\/js\/web\/index-[a-f0-9]+\.js/)[0];
    const r = await ctx.api.get(bundle).set('Accept-Encoding', 'gzip, br');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-encoding'] || '', /gzip|br/);
    assert.match(r.headers['cache-control'], /immutable/);
    const j = await ctx.api.get('/api/health').set('Accept-Encoding', 'gzip');
    assert.equal(j.status, 200);
  });
});

describe('M-12 booking limit (Mongo store; BOOKING_RATE_LIMIT=3 in this file)', () => {
  test('only created bookings count, the 4th is 429, owners are not limited, counters live in Mongo', async () => {
    const b = await createBusiness(ctx.api);
    const svc = String(b.business.services[0]._id);
    const date = daysFromToday(5);
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    assert.equal((await publicBook(ctx.api, b.slug, { serviceId: svc, date, startTime: '09:00' })).status, 201);
    for (let i = 0; i < 3; i++) {
      const dup = await publicBook(ctx.api, b.slug, { serviceId: svc, date, startTime: '09:00' });
      assert.equal(dup.status, 409, 'failed attempts do not count');
      await wait(50); // the store decrements after the response finishes
    }
    for (const t of ['10:00', '11:00']) {
      const r = await publicBook(ctx.api, b.slug, { serviceId: svc, date, startTime: t });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    const r4 = await publicBook(ctx.api, b.slug, { serviceId: svc, date, startTime: '12:00' });
    assert.equal(r4.status, 429); assert.equal(r4.body.code, 'rate_limited');
    await ownerBook(b, { date, startTime: '13:00' });
    const other = await createBusiness(ctx.api);
    const foreign = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(other.auth)
      .send({ customerName: 'QA Test X', customerPhone: '0500000990', serviceId: svc, date, startTime: '14:00' });
    assert.equal(foreign.status, 429, "another business's token is limited like the public");
    assert.ok(await ctx.db.collection('rate_limits').countDocuments({ _id: /^erl:booking:/ }) >= 1);
    await wait(100);
  });
});
