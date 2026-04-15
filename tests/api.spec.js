const { test, expect } = require('playwright/test');

const BASE = 'http://localhost:3000';

test.describe('Snaptor API Tests', () => {
  test('health check', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('get business by slug', async ({ request }) => {
    const res = await request.get(`${BASE}/api/businesses/narkis11`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('נרקיס');
    expect(body.slug).toBe('narkis11');
    // Should not expose private fields
    expect(body.phone).toBeUndefined();
    expect(body.email).toBeUndefined();
    expect(body._id).toBeUndefined();
  });

  test('business not found returns 404', async ({ request }) => {
    const res = await request.get(`${BASE}/api/businesses/nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('login with valid phone', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { phone: '0546666094' }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.businesses.length).toBeGreaterThanOrEqual(2);
  });

  test('login with invalid phone', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { phone: '0599999999' }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(false);
  });

  test('availability check', async ({ request }) => {
    const tomorrow = new Date(Date.now() + 86400000);
    // Find next working day (not Friday/Saturday for narkis11)
    let date = tomorrow;
    while ([5, 6].includes(date.getDay())) {
      date = new Date(date.getTime() + 86400000);
    }
    const dateStr = date.toISOString().split('T')[0];
    const res = await request.get(`${BASE}/api/businesses/narkis11/availability?date=${dateStr}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.date).toBe(dateStr);
  });

  test('check username availability', async ({ request }) => {
    const res = await request.get(`${BASE}/api/check-username/narkis11`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);

    const res2 = await request.get(`${BASE}/api/check-username/totally-free-slug`);
    const body2 = await res2.json();
    expect(body2.available).toBe(true);
  });

  test('admin login', async ({ request }) => {
    const res = await request.post(`${BASE}/api/admin/login`, {
      data: { password: 'snaptor2026' }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });

  test('admin login wrong password', async ({ request }) => {
    const res = await request.post(`${BASE}/api/admin/login`, {
      data: { password: 'wrong' }
    });
    expect(res.status()).toBe(401);
  });

  test('admin data requires auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/data`);
    expect(res.status()).toBe(401);
  });

  test('admin data with auth', async ({ request }) => {
    const loginRes = await request.post(`${BASE}/api/admin/login`, {
      data: { password: 'snaptor2026' }
    });
    const { token } = await loginRes.json();
    const res = await request.get(`${BASE}/api/admin/data`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.businesses).toBeDefined();
    expect(body.customers).toBeDefined();
    expect(body.appointments).toBeDefined();
    expect(body.businesses.length).toBeGreaterThanOrEqual(4);
  });

  test('protected endpoint requires auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/businesses/narkis11/appointments`);
    expect(res.status()).toBe(401);
  });

  test('admin page serves correctly', async ({ request }) => {
    const res = await request.get(`${BASE}/admin`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('Snaptor Admin');
  });
});
