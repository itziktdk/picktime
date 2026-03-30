# PickTime Prototype — Design Notes

## Design Decisions

### Philosophy
Apple-inspired "less is more" — every element earns its place. No clutter, no noise. The design breathes with generous whitespace and clean typography.

### Inspiration Sources
- **Cal.com** — Clean booking page layout, minimal step-by-step flow
- **Calendly** — The "perceived value" UX: making the customer feel important during booking
- **Fresha** — Service card selection pattern (icon + name + duration + price), salon-focused flows
- **Square Appointments** — Dashboard stats layout, sidebar navigation pattern
- **Acuity** — Multi-step booking with clear progress indication

## Color Palette

| Role | Color | Usage |
|------|-------|-------|
| Primary Dark | `#1a1a2e` → `#16213e` | Hero gradient, sidebar, business header |
| Accent | `#6366f1` (Indigo-500) | CTAs, active states, links, highlights |
| Accent Light | `#818cf8` | Hover states, gradient endpoints |
| Success | `#10b981` (Emerald) | Confirmations, completed states, availability |
| Background | `#ffffff` / `#f8fafc` | Page backgrounds |
| Text Primary | `#0f172a` | Headings, body text |
| Text Secondary | `#64748b` | Descriptions, metadata |
| Border | `#e2e8f0` | Cards, inputs, dividers |

## Typography

- **Hebrew:** Heebo (Google Fonts) — weights 300–900
- **English/Numbers:** Inter (Google Fonts) — weights 300–700
- Heading scale: `clamp()` for responsive sizing
- Letter spacing: tight (-1px to -2px) for headings

## UX Flow

### 5 Screens (all in one page):

1. **Landing/Hero** — Gradient dark background, floating orbs, stats bar. Inspired by modern SaaS landing pages.
2. **Onboarding Wizard** — 5-step progress bar with animated dots. Steps slide in. Business type selection uses icon cards (Fresha-inspired).
3. **Dashboard** — Dark sidebar + light content area. Stats cards with colored icons. Appointment list with time indicators and status pills.
4. **Customer Booking** — Card-based layout with business header. 4-step flow: Service → Date/Time → Details → Confirmation. Calendar widget + time slot pills.
5. **Confirmation** — Centered success card with checkmark animation, appointment details, and action buttons.

## Micro-interactions & Animations

- **Fade-in on scroll** — IntersectionObserver with staggered delays
- **Floating orbs** — CSS keyframe animation on hero background
- **Pulse dot** — Hero badge live indicator
- **Spring easing** — Progress dots scale with `cubic-bezier(0.34, 1.56, 0.64, 1)`
- **Slide transitions** — Wizard steps slide in from right (RTL)
- **Toggle switches** — Smooth knob translation with spring easing
- **Time slot hover lift** — `translateY(-2px)` + shadow on hover
- **Service card selection** — Border color + subtle background shift
- **Username availability** — Debounced check with loading/success/error states
- **Success checkmark** — Scale-in animation on confirmation

## Glass Morphism

Used sparingly on:
- Navigation bar (blur backdrop + semi-transparent bg)
- Hero badge

## RTL Considerations

- `dir="rtl"` on `<html>`
- All layouts flow right-to-left naturally via flexbox/grid
- Phone numbers and times use `direction: ltr` for readability
- Arrow icons point left (RTL forward direction)
- English inputs marked with `direction: ltr`

## Technical Details

- **Single file:** ~85KB, 2844 lines
- **Zero dependencies:** No frameworks, no CDN JS libraries
- **Fonts:** Google Fonts (Heebo + Inter)
- **Icons:** All Heroicons inline SVG (no images, no emoji)
- **CSS:** Custom properties, modern features (clamp, aspect-ratio, backdrop-filter)
- **JS:** Vanilla — IntersectionObserver, event delegation

## Next Steps for Production

1. **Component extraction** — Break into React/Vue/Svelte components
2. **Real data** — Connect to backend API (services, availability, bookings)
3. **Authentication** — OTP via SMS for business owners
4. **Calendar logic** — Real date calculations, availability engine
5. **Payment integration** — Stripe/PayPlus for Israeli market
6. **WhatsApp integration** — Automated reminders via WhatsApp Business API
7. **Analytics** — Track funnel conversion, popular time slots
8. **PWA** — Add manifest + service worker for app-like experience
9. **Accessibility** — Full ARIA labels, keyboard navigation, screen reader support
10. **Testing** — Cross-browser, cross-device QA
