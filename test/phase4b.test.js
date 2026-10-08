'use strict';
// Phase 4 round B: closed dates, staff time off / breaks, "any staff" union (P4-B5) and the
// customer's "my appointments" list behind a signed manage link (P4-B6).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness, publicBook, daysFromToday } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });
const avail = (b, date, q = {}) => ctx.api.get(`/api/businesses/${b.slug}/availability`).query({ date, ...q });
const svc = (b, i = 0) => String(b.business.services[i]._id);
const free = (r) => r.body.slots.filter(s => s.available).map(s => s.start);

describe('P4-B5 closed dates', () => {
  test('owner sets holidays; public page lists upcoming ones; availability + booking refuse; owner may still book', async () => {
    const b = await createBusiness(ctx.api);
    const d = daysFromToday(3), d2 = daysFromToday(4), past = daysFromToday(-10);
    let r = await ctx.api.put(`/api/businesses/${b.slug}`).set(b.auth).send({ closedDates: [{ from: d, to: d2, reason: 'חג' }, { from: past, to: past }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.closedDates.length, 2);
    const pub = await ctx.api.get(`/api/businesses/${b.slug}`);
    assert.deepEqual(pub.body.closedDates, [{ from: d, to: d2, reason: 'חג' }]);
    r = await avail(b, d2, { serviceId: svc(b) });
    assert.equal(r.body.available, false); assert.equal(r.body.reason, 'closed_date'); assert.equal(r.body.closedReason, 'חג');
    r = await publicBook(ctx.api, b.slug, { serviceId: svc(b), date: d, startTime: '10:00' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'closed');
    r = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: 'QA Test', customerPhone: '0500000990', serviceId: svc(b), date: d, startTime: '10:00' });
    assert.equal(r.status, 201);
    // the day after the range is open
    assert.equal((await avail(b, daysFromToday(5), { serviceId: svc(b) })).body.available, true);
  });
  test('validation: bad dates, reversed range, too long, too many', async () => {
    const b = await createBusiness(ctx.api);
    const put = (closedDates) => ctx.api.put(`/api/businesses/${b.slug}`).set(b.auth).send({ closedDates });
    assert.equal((await put([{ from: '2026-13-01' }])).status, 400);
    assert.equal((await put([{ from: daysFromToday(5), to: daysFromToday(2) }])).status, 400);
    assert.equal((await put([{ from: daysFromToday(1), to: daysFromToday(400) }])).status, 400);
    assert.equal((await put(Array.from({ length: 101 }, () => ({ from: daysFromToday(1) })))).status, 400);
    assert.equal((await put('x')).status, 400);
    const ok = await put([{ from: daysFromToday(2) }]);
    assert.equal(ok.status, 200); assert.deepEqual(ok.body.closedDates, [{ from: daysFromToday(2), to: daysFromToday(2) }]);
    assert.deepEqual((await put([])).body.closedDates, []);
  });
});

describe('P4-B5 staff time off, staff breaks, any-staff union', () => {
  async function team() {
    const b = await createBusiness(ctx.api);
    const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const early = Object.fromEntries(DAYS.map(d => [d, { enabled: true, start: '08:00', end: '12:00', breaks: [{ start: '10:00', end: '10:30' }] }]));
    const late = Object.fromEntries(DAYS.map(d => [d, { enabled: true, start: '14:00', end: '18:00' }]));
    const r = await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: [
      { name: 'QA Early', services: [], workingHours: early },
      { name: 'QA Late', services: [], workingHours: late, timeOff: [{ from: daysFromToday(2), to: daysFromToday(2), note: 'מילואים' }] },
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [e, l] = r.body.staff;
    return { b, early: String(e._id), late: String(l._id) };
  }
  test('any staff = union of working staff (inside business hours); breaks and time off respected', async () => {
    const { b, early, late } = await team();
    const d1 = daysFromToday(1), d2 = daysFromToday(2);
    let r = await avail(b, d1, { serviceId: svc(b) }); // 30 min
    let f = free(r);
    assert.ok(f.includes('08:00') && f.includes('11:30') && f.includes('14:00') && f.includes('17:30'), f.join());
    assert.ok(!f.includes('10:00') && !f.includes('12:00') && !f.includes('13:30'), 'early break / gap not bookable: ' + f.join());
    // Late is off on d2: only the morning
    r = await avail(b, d2, { serviceId: svc(b) });
    f = free(r);
    assert.ok(f.includes('08:00') && !f.includes('14:00'), f.join());
    assert.deepEqual(r.body.availableStaff.map(s => s.name), ['QA Early']);
    r = await avail(b, d2, { serviceId: svc(b), staffId: late });
    assert.equal(r.body.reason, 'staff_time_off');
    // explicit staff with a break
    r = await avail(b, d1, { serviceId: svc(b), staffId: early });
    assert.ok(!free(r).includes('10:00'));
    let bk = await publicBook(ctx.api, b.slug, { serviceId: svc(b), staffId: early, date: d1, startTime: '10:00' });
    assert.equal(bk.status, 400); assert.equal(bk.body.code, 'outside_hours');
    bk = await publicBook(ctx.api, b.slug, { serviceId: svc(b), staffId: late, date: d2, startTime: '15:00' });
    assert.equal(bk.status, 400); assert.equal(bk.body.code, 'staff_day_off');
    // any staff at 15:00 on d1 → assigned to Late
    bk = await publicBook(ctx.api, b.slug, { serviceId: svc(b), date: d1, startTime: '15:00', customerPhone: '0500000991' });
    assert.equal(bk.status, 201, JSON.stringify(bk.body)); assert.equal(bk.body.staffName || bk.body.appointment?.staffName, 'QA Late');
    // public staff list shows time off dates but not the note; owner list keeps the note
    const pub = await ctx.api.get(`/api/businesses/${b.slug}`);
    const pl = pub.body.staff.find(s => s.name === 'QA Late');
    assert.deepEqual(pl.timeOff, [{ from: d2, to: d2 }]);
    const all = await ctx.api.get(`/api/businesses/${b.slug}/staff/all`).set(b.auth);
    assert.equal(all.body.find(s => s.name === 'QA Late').timeOff[0].note, 'מילואים');
    // saving staff without timeOff keeps it; bad timeOff rejected
    const keep = await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: all.body.map(s => ({ _id: s._id, name: s.name, services: s.services })) });
    assert.equal(keep.body.staff.find(s => s.name === 'QA Late').timeOff.length, 1);
    const bad = await ctx.api.put(`/api/businesses/${b.slug}/staff`).set(b.auth).send({ staff: [{ name: 'QA X', timeOff: [{ from: 'nope' }] }] });
    assert.equal(bad.status, 400);
  });
  test('owner "any staff" prefers someone who is working', async () => {
    const { b } = await team();
    const r = await ctx.api.post(`/api/businesses/${b.slug}/appointments`).set(b.auth).send({ customerName: 'QA Test', customerPhone: '0500000992', serviceId: svc(b), date: daysFromToday(1), startTime: '15:00' });
    assert.equal(r.status, 201); assert.equal(r.body.staffName || r.body.appointment?.staffName, 'QA Late');
  });
});

describe('P4-B6 my appointments via manage link', () => {
  test('lists the same customer\'s other upcoming active appointments with their own links; nothing else leaks', async () => {
    const b = await createBusiness(ctx.api);
    const other = await createBusiness(ctx.api);
    const mk = async (biz, body) => { const r = await publicBook(ctx.api, biz.slug, { serviceId: svc(biz), ...body }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
    const a1 = await mk(b, { date: daysFromToday(1), startTime: '09:00', customerPhone: '050-000-0993' });
    const a2 = await mk(b, { date: daysFromToday(3), startTime: '10:00', customerPhone: '0500000993' });
    const a3 = await mk(b, { date: daysFromToday(2), startTime: '11:00', customerPhone: '0500000993' });
    await mk(b, { date: daysFromToday(2), startTime: '12:00', customerPhone: '0500000994' }); // someone else
    await mk(other, { date: daysFromToday(2), startTime: '12:00', customerPhone: '0500000993' }); // other business
    await ctx.api.post(`/api/manage/${a3.manageToken}/cancel`).send({});
    const r = await ctx.api.get(`/api/manage/${a1.manageToken}/others`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.appointments.map(x => [x.date, x.startTime]), [[daysFromToday(3), '10:00']]);
    const link = r.body.appointments[0];
    assert.equal(Object.keys(link).includes('customerPhone'), false);
    const back = await ctx.api.get(`/api/manage/${link.manageToken}`);
    assert.equal(back.status, 200); assert.equal(back.body.appointment.startTime, '10:00');
    const rev = await ctx.api.get(`/api/manage/${a2.manageToken}/others`);
    assert.deepEqual(rev.body.appointments.map(x => x.startTime), ['09:00']);
    assert.equal((await ctx.api.get(`/api/manage/${a1.manageToken.slice(0, -2)}xx/others`)).status, 404);
  });
});
