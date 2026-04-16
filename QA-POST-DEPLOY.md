# QA Post-Deploy Report — Snaptor.app
**Date:** 2026-04-16T06:22 UTC  
**Tester:** Playwright (headless Chromium)  
**Note:** The site has intermittent slow loading (SPA timeouts on `domcontentloaded`/`networkidle`). Some tests required multiple attempts. Results below are based on actual screenshots captured across runs.

---

## Summary: 🟡 MOSTLY WORKING — Issues Found

| Category | Status |
|----------|--------|
| Landing Page | ✅ PASS |
| Login (Multi-Business) | ⚠️ PARTIAL |
| Login (Single Business) | ❌ FAIL |
| Admin Panel | ⚠️ PARTIAL |
| Booking Page | ✅ PASS |
| Dashboard | ✅ PASS |
| Staff Page | ⚠️ UNTESTED (timeouts) |
| Mobile View | ✅ PASS |

---

## 1. Landing Page — ✅ PASS
**Screenshot:** `landing.png`, `mobile-landing.png`

- Page loads with nice dark hero section
- Logo, tagline "ניהול תורים בלי כאב ראש" renders correctly
- "כניסה למערכת" button visible top-left
- Stats section shows (4.9 rating, 150K+ תורים, 2,400+ עסקים)
- Language selector (עברית) present
- CTA "צור את העסק שלך בחינם" prominent
- **Issue:** `<title>` tag appears empty (Playwright reported empty title). Not critical but bad for SEO.

## 2. Login Flow (Multi-Business) — ⚠️ PARTIAL
**Screenshots:** `login-result.png` (from run 1), `dashboard-after-select.png`

- Login page renders correctly with phone input and "התחברות" button
- Entered phone 0546666094 → **business selector appeared**
- **נרקיס found ✅**, but **מנשה צדקה NOT displayed** in the selector in one run (PARTIAL detection)
- After selecting נרקיס → Dashboard loaded successfully!
- Dashboard shows: "בוקר טוב ✳, נרקיס" with date, recent customers (דוד, פלוני אלמוהי), stats (2 תורים השבוע, 0₪ הכנסות, 0 תורים היום)
- Bottom nav: לוח בקרה, תורים, לקוחות, משלות, הגדרות — all visible
- Notification bell with badge (2) visible
- **Issue:** Could not verify if מנשה צדקה appears in business selector. May be a rendering timing issue.

## 3. Login Flow (Single Business) — ❌ FAIL
**Screenshot:** `single-login-result.png`

- Entered phone 0501234567 (test-barber, expected single business → direct to dashboard)
- **ACTUAL RESULT:** Redirected to `/register` page (business registration wizard step 1/5)
- Shows "פרטי העסק" form asking for business name, slug, phone
- **This is WRONG** — existing user with single business should go straight to dashboard, not registration
- **Bug: Login with existing single-business phone redirects to registration instead of dashboard**

## 4. Admin Panel — ⚠️ PARTIAL  
**Screenshots:** `admin-businesses.png`, `admin-customers.png`, `admin-appointments.png`

### What works:
- Admin login with password "snaptor2026" ✅
- Dashboard shows stats: 4 עסקים, 3 לקוחות, 8 תורים, 4 תורים השבוע ✅
- Businesses tab shows all 4 businesses with correct data ✅
- Tabs (עסקים, לקוחות, תורים) are clickable ✅
- "רענון" (refresh) and "יציאה" (logout) buttons present ✅
- Live update timestamp shown ✅

### What's missing/broken:
- ❌ **No "כניסה אחרונה" (last login) column** — table shows: שם, SLUG, סוג, טלפון, שירותים, נוצר, מחק. No last login data.
- ❌ **No Edit button** — only "מחק" (delete) button per row. No way to edit a business.
- ❌ **No Active/Inactive toggle** — no toggle/switch visible anywhere in the admin panel
- ⚠️ **Customers and Appointments tabs** — screenshots show same businesses view (may be a tab-switching timing issue, or tabs don't actually change content)

## 5. Booking Page — ✅ PASS
**Screenshot:** `mobile-booking.png` (captured in mobile test)

- `/book/narkis11` loads correctly
- Shows business name "נרקיס" with subtitle "קוסמטיקה"
- "בחירת שירות" section displays 3 services:
  - מניקור — 30 דק׳ — 60₪
  - גבות — 45 דק׳ — 80₪
  - ספישל חגים — 15 דק׳ — 50₪
- Clean card layout, prices visible, durations shown
- Snaptor branding footer ⚡
- **Could not test full flow** (date/time selection) due to timeouts on subsequent navigation

## 6. Dashboard Features — ✅ PASS (from screenshots captured)
**Screenshots:** `dashboard-after-select.png`, `login-result.png`

- Dashboard home shows greeting, date, recent customers, stats cards ✅
- Bottom navigation bar with 5 tabs: לוח בקרה, תורים, לקוחות, משלות, הגדרות ✅
- Filter buttons: היום, ממתינים 2, בקשות שינוי, שבועי ✅
- "אין תורים קרובים" message when no upcoming appointments ✅
- **Could not screenshot individual tabs** (תורים, לקוחות, הגדרות) due to navigation timeouts
- **Note:** Dashboard loaded via business selector but individual tab navigation wasn't captured

## 7. Staff Page — ⚠️ UNTESTED
- Could not reach staff settings page due to repeated navigation timeouts
- No screenshot captured
- **Cannot confirm or deny RTL overflow bug**

## 8. Mobile View (375x812) — ✅ PASS
**Screenshots:** `mobile-landing.png`, `mobile-booking.png`, `mobile-dashboard.png`

- **Landing:** Responsive, all elements stack properly, CTA button full-width, stats row fits ✅
- **Booking:** Services display cleanly in card format, business name centered, prices aligned ✅
- **Dashboard (login page):** Login form renders well on mobile, button full-width, centered layout ✅
- No horizontal overflow detected
- RTL layout looks correct on mobile

---

## Critical Issues Found

### 🔴 Bug 1: Single-Business Login Broken
Phone `0501234567` (test-barber) redirects to `/register` instead of dashboard. This means single-business users **cannot log in**.

### 🟡 Bug 2: Admin Missing Features
- No "כניסה אחרונה" column
- No Edit button (only Delete)  
- No Active/Inactive toggle
These were expected features per the test spec.

### 🟡 Bug 3: Empty Page Title
`<title>` tag is empty — bad for SEO and browser tabs.

### 🟡 Bug 4: Site Performance / Timeouts
Multiple page navigations timed out at 30s. The SPA seems to have connection keep-alive issues or heavy initial bundle that blocks `domcontentloaded`. This affected testing coverage significantly.

---

## Verdict

**🟡 PARTIALLY WORKING** — The core happy path (landing → login with multi-business → select business → dashboard) works. Booking page renders beautifully. Mobile responsive is solid. But single-business login is broken (redirects to registration), and the admin panel is missing several expected features (edit, toggle, last login). Site performance is inconsistent with frequent timeouts.

## Screenshots
All saved to `qa-post-deploy/`:
- `landing.png` — Desktop landing page
- `login-result.png` — After multi-business login (dashboard from run 1)  
- `dashboard-after-select.png` — Dashboard after selecting נרקיס
- `single-login-result.png` — Registration page (BUG)
- `admin-businesses.png` — Admin businesses tab
- `admin-customers.png` — Admin (same as businesses - tab switch issue)
- `admin-appointments.png` — Admin (same as businesses - tab switch issue)
- `mobile-landing.png` — Mobile landing
- `mobile-booking.png` — Mobile booking for נרקיס
- `mobile-dashboard.png` — Mobile login page
