# Snaptor Night Shift Log — 2026-04-15

## Summary
Comprehensive cleanup, bug fixes, admin dashboard, and new public booking page.

## What Was Done

### Phase 1: DB Cleanup ✅
- **Cleaned 14 test/XSS businesses** from DB (kept: narkis11, menashe, dana-studio, test-barber)
- Deleted associated appointments (2), customers (7), tasks (6), announcements (7)
- Commit: `9ad07ca`

### Phase 2: Bug Fixes ✅
1. **Stats endpoint businessId type mismatch** — Stats queries used string but appointments stored ObjectId. Fixed with `$in: [bid, bidStr]` query.
   - Commit: `d08492f`

2. **Login multi-business support** — Phone 0546666094 has 2 businesses (narkis11 + menashe). Login now returns ALL matching businesses + supports `slug` param for selection.
   - Commit: `b59dd5e`

3. **Hardcoded Azure URL in frontend** — Expo bundle had `https://picktime-app.azurewebsites.net/api` hardcoded. Changed to relative `/api` so it works on both domains.
   - Commit: `93e5d5f`

### Phase 3: Public Booking Page ✅
- Built a standalone, lightweight HTML booking page at `/book/:slug`
- Apple-inspired design, RTL Hebrew, mobile-first
- Full 4-step flow: Service → Date → Time → Details → Confirmation
- Uses Heebo font, Heroicons SVGs, Indigo color scheme
- Shows availability, validates phone, handles errors
- Commit: `3717dbe`

### Phase 4: Admin Dashboard ✅
- Built at `/admin` with password protection (snaptor2026)
- Features:
  - Stats: business count, customer count, appointment count, weekly appointments
  - Businesses tab: name, slug, type, phone, services count, creation date
  - Customers tab: name, phone, business, visits, spending, last visit
  - Appointments tab: date, time, customer, service, business, status
  - Delete business capability (with all associated data)
  - Refresh button, last update timestamp
- Commits: `9ad07ca`, `041dcf0`, `377a922`

### Testing ✅
- **21 Playwright tests, ALL PASSING**
  - 13 API tests (health, business CRUD, auth, admin, availability, etc.)
  - 4 admin browser tests (login, tabs, error handling)
  - 4 booking page browser tests (load, 404, services, date picker)
- Commits: `a9dfe26`, `6a93869`, `3717dbe`

### Deployment ✅
- Fixed stuck Azure deployment (Oryx build timeout)
- Used VFS + Kudu command API to upload files and run `npm install`
- App running at https://snaptor.app with all changes deployed
- All endpoints verified working on production

## Commit History
| Commit | Description |
|--------|-------------|
| `9ad07ca` | feat: Admin dashboard + DB cleanup |
| `d08492f` | fix: Stats endpoint businessId type mismatch |
| `b59dd5e` | fix: Login returns all businesses for same phone |
| `041dcf0` | improve: Admin dashboard refresh + timestamp |
| `93e5d5f` | fix: Replace hardcoded URL with relative /api |
| `377a922` | feat: Admin can delete businesses |
| `a9dfe26` | test: 13 API tests |
| `6a93869` | test: 4 admin browser tests (17 total) |
| `3717dbe` | feat: Public booking page + 4 tests (21 total) |

## Live URLs
- **App**: https://snaptor.app
- **Admin**: https://snaptor.app/admin (password: snaptor2026)
- **Booking**: https://snaptor.app/book/narkis11

## Still TODO
- [ ] Onboarding wizard improvements (requires Expo source)
- [ ] Dashboard analytics beyond stats endpoint (requires Expo source)
- [ ] WhatsApp reminder integration (cron job needed)
- [ ] Staff booking flow in public booking page
- [ ] Customer notifications (email/SMS)
- [ ] Set up GitHub Actions for auto-deploy to Azure
- [ ] Consider rebuilding Expo frontend with relative API URL at source level
