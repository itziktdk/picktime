'use strict';
// Sprint 1 F4: contact import with in-file + existing dedupe, non-destructive merge, dry run, undo.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createBusiness } = require('./helpers');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.teardown(); });

describe('S1-F4 contact import', () => {
  test('dry run, import, dedupe, merge without overwriting, undo', async () => {
    const b = await createBusiness(ctx.api);
    const C = (q = '') => ctx.api.get(`/api/businesses/${b.slug}/customers${q}`).set(b.auth);
    // existing customer typed by the owner
    let r = await ctx.api.post(`/api/businesses/${b.slug}/customers`).set(b.auth).send({ name: 'QA Test Owner Typed', phone: '050-000-0980', notes: 'keep me' });
    assert.equal(r.status, 201);
    const rows = [
      { name: 'QA Test Import A', phone: '+972 50-000-0981', email: 'a@example.com', tags: ['Imported'] },
      { name: 'QA Test Import A dup', phone: '0500000981', notes: 'second row fills notes' },
      { name: 'QA Test Other Name', phone: '0500000980', email: 'owner@example.com', notes: 'should not replace' },
      { name: 'QA Test Bad', phone: '12345' },
      { name: '', phone: '0500000982', birthday: '03-14' },
    ];
    r = await ctx.api.post(`/api/businesses/${b.slug}/customers/import`).set(b.auth).send({ rows, dryRun: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.created, r.body.merged, r.body.skipped.length], [2, 1, 2]);
    assert.equal((await C()).body.length, 1, 'dry run writes nothing');
    r = await ctx.api.post(`/api/businesses/${b.slug}/customers/import`).set(b.auth).send({ rows, source: 'csv' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const batchId = r.body.batchId;
    assert.ok(batchId);
    const all = (await C()).body;
    assert.equal(all.length, 3);
    const a = all.find(c => c.phone === '0500000981');
    assert.equal(a.name, 'QA Test Import A'); assert.equal(a.notes, 'second row fills notes'); assert.equal(a.source, 'import');
    const owner = all.find(c => c.phone === '050-000-0980');
    assert.equal(owner.name, 'QA Test Owner Typed'); assert.equal(owner.notes, 'keep me'); assert.equal(owner.email, 'owner@example.com');
    assert.equal(all.find(c => c.phone === '0500000982').birthday, '03-14');
    // re-import is idempotent
    r = await ctx.api.post(`/api/businesses/${b.slug}/customers/import`).set(b.auth).send({ rows, dryRun: true });
    assert.deepEqual([r.body.created, r.body.merged], [0, 0]);
    // undo: created removed, merged restored
    r = await ctx.api.post(`/api/businesses/${b.slug}/customers/import/${batchId}/undo`).set(b.auth);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.removed, 2); assert.equal(r.body.restored, 1);
    const after1 = (await C()).body;
    assert.equal(after1.length, 1);
    assert.equal(after1[0].email || '', '');
    assert.equal((await ctx.api.post(`/api/businesses/${b.slug}/customers/import/${batchId}/undo`).set(b.auth)).status, 409);
  });
  test('limits and isolation', async () => {
    const a = await createBusiness(ctx.api), b = await createBusiness(ctx.api);
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/customers/import`).set(a.auth).send({ rows: [] })).status, 400);
    const many = Array.from({ length: 3001 }, (_, i) => ({ name: 'x', phone: '05' + String(10000000 + i) }));
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/customers/import`).set(a.auth).send({ rows: many, dryRun: true })).status, 400);
    const ok = Array.from({ length: 2500 }, (_, i) => ({ name: 'QA Test Bulk ' + i, phone: '05' + String(20000000 + i) }));
    let r = await ctx.api.post(`/api/businesses/${a.slug}/customers/import`).set(a.auth).send({ rows: ok });
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 200)); assert.equal(r.body.created, 2500);
    assert.equal((await ctx.api.post(`/api/businesses/${b.slug}/customers/import/${r.body.batchId}/undo`).set(b.auth)).status, 404);
    assert.equal((await ctx.api.post(`/api/businesses/${a.slug}/customers/import/${r.body.batchId}/undo`).set(b.auth)).status, 403);
    // account deletion removes import batches
    r = await ctx.api.delete('/api/account').set(a.auth).send({ confirmSlug: a.slug });
    assert.equal(r.status, 200);
    assert.equal(await ctx.db.collection('customer_imports').countDocuments({ businessId: String(a.business._id) }), 0);
  });
});
