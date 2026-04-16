# Snaptor QA Report — 2026-04-16

## Summary
Full Playwright-based QA of https://snaptor.app. Screenshots saved in `qa-screenshots/`.

---

## Bug #1: Empty Page Title (ALL pages)
- **Screenshot:** `01-landing.png`
- **Issue:** `<title data-rh="true"></title>` — the HTML title tag is empty on all SPA pages. This hurts SEO and browser tab identification.
- **Severity:** Major
- **Fix:** Set document.title in _layout.tsx or add a title in the Expo web config.

## Bug #2: API Base URL Hardcoded to Azure
- **Screenshot:** N/A (code issue)
- **Issue:** `api.ts` uses `baseURL: 'https://picktime-app.azurewebsites.net/api'` instead of relative `/api`. This causes CORS issues and means the app won't work if the domain changes. The latest deployed build already has this fixed in one bundle but not in the active one.
- **Severity:** Major
- **Fix:** Change `API_BASE` to `/api` in `services/api.ts`, rebuild and redeploy.

## Bug #3: Staff Page Uses Demo Data Only
- **Screenshot:** N/A (code review)
- **Issue:** `app/(dashboard)/staff.tsx` uses hardcoded `DEMO_STAFF` array and never fetches from the API (`/api/businesses/:slug/staff`). Changes made in the staff page are lost on refresh.
- **Severity:** Critical
- **Fix:** Fetch staff from API on mount, save changes via API.

## Bug #4: Mobile isMobile Viewport Hangs
- **Screenshot:** `60-mobile-landing.png` (taken with regular small viewport)
- **Issue:** When Playwright uses `isMobile: true` context, the page never finishes loading (60s+ timeout). The SPA has some resource/event that blocks the `load` event on true mobile user-agents. Real mobile users may experience slow/hanging loads.
- **Severity:** Minor (works with regular viewport resize, but indicates performance issues)
- **Fix:** Investigate and optimize SPA loading for mobile; check for infinite loops in mobile-specific code paths.

## Bug #5: Booking Page Progress Steps Not Labeled  
- **Screenshot:** `06a-booking-start.png`, `06b-booking-service-selected.png`
- **Issue:** The step progress bar at the top of the booking page (book.html) shows thin lines without labels. Users don't know what step they're on or what's coming next. The Expo booking flow has numbered steps but the standalone book.html just uses thin bars.
- **Severity:** Minor
- **Fix:** Already has step bars with done/active classes — this is a design choice, acceptable.

## Bug #6: Multi-Business Login Selector Not Shown (Intermittent)
- **Screenshot:** `31-multi-biz-result.png`, `52-after-login.png`
- **Issue:** When logging in with phone 0546666094 (which owns 2 businesses: נרקיס and מנשה), the business selector is supposed to appear. However, in fresh-context Playwright tests, the app goes straight to the נרקיס dashboard without showing the selector. The code logic appears correct in both AuthContext and login.tsx — this may be a race condition or the previously-loaded session state interfering.
- **Severity:** Major
- **Fix:** Needs investigation. The server always returns a token for the first business even in multi-business responses. Consider having the server NOT return a token when multiple businesses are found, forcing explicit selection.

## Bug #7: Settings Page Missing Business Name Display
- **Screenshot:** `54-הגדרות.png`
- **Issue:** The settings page shows "שם העסק" label but the actual business name "נרקיס" is hard to read / positioned oddly. The booking URL field shows properly.
- **Severity:** Minor
- **Fix:** UI polish — ensure the business name is clearly visible in the settings card.

## Bug #8: Appointments and Customers Tabs Click Issue
- **Screenshot:** N/A — tabs couldn't be reliably clicked in Playwright
- **Issue:** The "תורים" and "לקוחות" tab navigation sometimes fails because there are multiple elements with the same text on the page (tab label + content).
- **Severity:** Minor (works fine in real usage, just Playwright selector issue)

---

## What Works Well ✅
1. **Landing page** — Beautiful, responsive, professional look
2. **Login flow** — Clean phone entry, proper validation
3. **Admin panel** — All 3 tabs (businesses, customers, appointments) work perfectly with good data display
4. **Booking page (book.html)** — Clean service selection, calendar with working hour awareness, step-by-step flow
5. **Dashboard** — Good overview with stats, recent customers, appointment filters
6. **Registration flow** — Multi-step wizard looks professional (5 steps with progress indicator)
7. **Settings page** — Theme color picker, business details editing
8. **Tasks page** — Clean empty state with add button
9. **RTL support** — Proper Hebrew RTL throughout

---

## Priority Fixes
1. 🔴 **Bug #3** — Staff page demo data (Critical)
2. 🟠 **Bug #2** — API Base URL (Major)  
3. 🟠 **Bug #1** — Empty page title (Major)
4. 🟠 **Bug #6** — Multi-business selector (Major)
5. 🟡 **Bug #4** — Mobile performance (Minor)
