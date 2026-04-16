# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking.spec.js >> Public Booking Page >> service selection shows date picker
- Location: tests/booking.spec.js:26:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('#step-2')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#step-2')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - heading "נרקיס" [level=1] [ref=e5]
    - generic [ref=e6]: קוסמטיקה
  - generic [ref=e12]:
    - heading "בחירת שירות" [level=2] [ref=e13]:
      - img [ref=e14]
      - text: בחירת שירות
    - generic [ref=e17]:
      - generic [ref=e18] [cursor=pointer]:
        - generic [ref=e19]:
          - generic [ref=e20]: מניקור
          - generic [ref=e22]: 30 דק׳
        - generic [ref=e23]: ₪60
      - generic [ref=e24] [cursor=pointer]:
        - generic [ref=e25]:
          - generic [ref=e26]: גבות
          - generic [ref=e28]: 45 דק׳
        - generic [ref=e29]: ₪80
      - generic [ref=e30] [cursor=pointer]:
        - generic [ref=e31]:
          - generic [ref=e32]: ספישל חגים
          - generic [ref=e34]: 15 דק׳
        - generic [ref=e35]: ₪50
  - generic [ref=e36]:
    - heading "בחירת תאריך" [level=2] [ref=e37]:
      - img [ref=e38]
      - text: בחירת תאריך
    - generic [ref=e40]:
      - button "›" [ref=e41] [cursor=pointer]
      - generic [ref=e42]: אפריל 2026
      - button "‹" [ref=e43] [cursor=pointer]
    - generic [ref=e44]:
      - generic [ref=e45]: א׳
      - generic [ref=e46]: ב׳
      - generic [ref=e47]: ג׳
      - generic [ref=e48]: ד׳
      - generic [ref=e49]: ה׳
      - generic [ref=e50]: ו׳
      - generic [ref=e51]: ש׳
      - generic [ref=e55]: "1"
      - generic [ref=e56]: "2"
      - generic [ref=e57]: "3"
      - generic [ref=e58]: "4"
      - generic [ref=e59]: "5"
      - generic [ref=e60]: "6"
      - generic [ref=e61]: "7"
      - generic [ref=e62]: "8"
      - generic [ref=e63]: "9"
      - generic [ref=e64]: "10"
      - generic [ref=e65]: "11"
      - generic [ref=e66]: "12"
      - generic [ref=e67]: "13"
      - generic [ref=e68]: "14"
      - generic [ref=e69]: "15"
      - generic [ref=e70] [cursor=pointer]: "16"
      - generic [ref=e71]: "17"
      - generic [ref=e72]: "18"
      - generic [ref=e73] [cursor=pointer]: "19"
      - generic [ref=e74] [cursor=pointer]: "20"
      - generic [ref=e75]: "21"
      - generic [ref=e76] [cursor=pointer]: "22"
      - generic [ref=e77] [cursor=pointer]: "23"
      - generic [ref=e78]: "24"
      - generic [ref=e79]: "25"
      - generic [ref=e80] [cursor=pointer]: "26"
      - generic [ref=e81] [cursor=pointer]: "27"
      - generic [ref=e82]: "28"
      - generic [ref=e83] [cursor=pointer]: "29"
      - generic [ref=e84] [cursor=pointer]: "30"
  - link "Snaptor ⚡" [ref=e86] [cursor=pointer]:
    - /url: https://snaptor.app
```

# Test source

```ts
  1  | const { test, expect } = require('playwright/test');
  2  | 
  3  | const BASE = 'http://localhost:3000';
  4  | 
  5  | test.describe('Public Booking Page', () => {
  6  |   test('loads business info', async ({ page }) => {
  7  |     await page.goto(`${BASE}/book/narkis11`);
  8  |     await expect(page.locator('#biz-name')).toHaveText('נרקיס', { timeout: 10000 });
  9  |     await expect(page.locator('#app')).toBeVisible();
  10 |   });
  11 | 
  12 |   test('shows 404 for invalid slug', async ({ page }) => {
  13 |     await page.goto(`${BASE}/book/nonexistent-biz`);
  14 |     await expect(page.locator('#not-found')).toBeVisible({ timeout: 10000 });
  15 |   });
  16 | 
  17 |   test('shows services list', async ({ page }) => {
  18 |     await page.goto(`${BASE}/book/narkis11`);
  19 |     await expect(page.locator('#biz-name')).toHaveText('נרקיס', { timeout: 10000 });
  20 |     const services = page.locator('.service-item');
  21 |     await expect(services.first()).toBeVisible();
  22 |     const count = await services.count();
  23 |     expect(count).toBeGreaterThanOrEqual(2);
  24 |   });
  25 | 
  26 |   test('service selection shows date picker', async ({ page }) => {
  27 |     await page.goto(`${BASE}/book/narkis11`);
  28 |     await expect(page.locator('#biz-name')).toHaveText('נרקיס', { timeout: 10000 });
  29 |     await page.locator('.service-item').first().click();
> 30 |     await expect(page.locator('#step-2')).toBeVisible();
     |                                           ^ Error: expect(locator).toBeVisible() failed
  31 |     await expect(page.locator('#month-label')).toBeVisible();
  32 |   });
  33 | });
  34 | 
```