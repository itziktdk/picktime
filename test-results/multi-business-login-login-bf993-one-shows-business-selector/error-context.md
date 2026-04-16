# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multi-business-login.spec.js >> login with multi-business phone shows business selector
- Location: tests/multi-business-login.spec.js:5:1

# Error details

```
TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('text=בחר עסק') to be visible

```

# Page snapshot

```yaml
- generic [ref=e8]:
  - generic [ref=e15]:
    - generic [ref=e16]:
      - generic [ref=e17]:
        - generic [ref=e18]:
          - generic [ref=e19]: בוקר טוב ☀, נרקיס
          - generic [ref=e20]: יום חמישי, 16 באפריל 2026
        - generic [ref=e21]:
          - img [ref=e23] [cursor=pointer]
          - generic [ref=e25] [cursor=pointer]:
            - img [ref=e26]
            - generic [ref=e29]: "1"
      - generic [ref=e30]:
        - generic [ref=e31]:
          - generic [ref=e32]: לקוחות אחרונים
          - generic [ref=e34] [cursor=pointer]: הכל →
        - generic [ref=e36]:
          - generic [ref=e37] [cursor=pointer]:
            - generic [ref=e39]: דו
            - generic [ref=e40]: דוד
          - generic [ref=e41] [cursor=pointer]:
            - generic [ref=e43]: פא
            - generic [ref=e44]: פלוני אלמוהי
      - generic [ref=e45]:
        - generic [ref=e46]:
          - img [ref=e48]
          - generic [ref=e50]: "0"
          - generic [ref=e51]: תורים היום
        - generic [ref=e52]:
          - img [ref=e54]
          - generic [ref=e56]: ₪0
          - generic [ref=e57]: הכנסות השבוע
        - generic [ref=e58]:
          - img [ref=e60]
          - generic [ref=e62]: "2"
          - generic [ref=e63]: תורים השבוע
      - generic [ref=e64]:
        - generic [ref=e65]:
          - generic [ref=e66]: "3"
          - generic [ref=e67]: תורים השבוע
        - generic [ref=e68]:
          - generic [ref=e69]: ₪140
          - generic [ref=e70]: הכנסות השבוע
        - generic [ref=e71]:
          - generic [ref=e72]: 0%
          - generic [ref=e73]: אחוז ביטולים
        - generic [ref=e74]:
          - generic [ref=e75]: "0"
          - generic [ref=e76]: לקוחות חדשים
      - generic [ref=e78]:
        - generic [ref=e80] [cursor=pointer]: היום
        - generic [ref=e81] [cursor=pointer]:
          - generic [ref=e82]: ממתינים
          - generic [ref=e84]: "1"
        - generic [ref=e86] [cursor=pointer]: בקשות שינוי
        - generic [ref=e88] [cursor=pointer]: יומי
        - generic [ref=e90] [cursor=pointer]: שבועי
        - generic [ref=e92] [cursor=pointer]: חודשי
      - generic [ref=e94]: אין תורים קרובים
    - img [ref=e96] [cursor=pointer]
  - tablist [ref=e99]:
    - tab "לוח בקרה" [selected] [ref=e101] [cursor=pointer]:
      - generic [ref=e102]:
        - img [ref=e104]
        - img [ref=e107]
      - generic [ref=e109]: לוח בקרה
    - tab "תורים" [ref=e111] [cursor=pointer]:
      - generic [ref=e112]:
        - img [ref=e114]
        - img [ref=e117]
      - generic [ref=e119]: תורים
    - tab "לקוחות" [ref=e121] [cursor=pointer]:
      - generic [ref=e122]:
        - img [ref=e124]
        - img [ref=e127]
      - generic [ref=e129]: לקוחות
    - tab "מטלות" [ref=e131] [cursor=pointer]:
      - generic [ref=e132]:
        - img [ref=e134]
        - img [ref=e137]
      - generic [ref=e139]: מטלות
    - tab "הגדרות" [ref=e141] [cursor=pointer]:
      - generic [ref=e142]:
        - img [ref=e144]
        - img [ref=e148]
      - generic [ref=e151]: הגדרות
```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | 
  3  | const BASE = 'http://localhost:3000';
  4  | 
  5  | test('login with multi-business phone shows business selector', async ({ page }) => {
  6  |   await page.goto(`${BASE}/login`);
  7  |   
  8  |   // Wait for login form
  9  |   await page.waitForSelector('input[type="tel"]', { timeout: 10000 });
  10 |   
  11 |   // Enter multi-business phone number
  12 |   await page.fill('input[type="tel"]', '0546666094');
  13 |   
  14 |   // Click login button
  15 |   await page.locator('button[role="button"]').filter({ hasText: /התחברות/i }).first().click();
  16 |   
  17 |   // Wait for business selection to appear
> 18 |   await page.waitForSelector('text=בחר עסק', { timeout: 10000 });
     |              ^ TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.
  19 |   
  20 |   // Should show both businesses
  21 |   await expect(page.locator('text=נרקיס')).toBeVisible();
  22 |   await expect(page.locator('text=מנשה צדקה')).toBeVisible();
  23 |   
  24 |   console.log('✅ Multi-business login selector works!');
  25 | });
  26 | 
```