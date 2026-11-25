# Mawid (موعد)

Arabic/English appointment booking for small salons, gyms and clinics. A public booking page per business, and a dashboard for the team.

Product direction and scope: Nada Gamal. Implementation: AI-assisted (Instinct).

## What it does
- Public booking page: service, person (or "any available"), real free slots, details, confirmation code. No deposit.
- Customer manage page: look up by code + phone, reschedule or cancel (late cancels are flagged).
- Dashboard: day/week calendar per staff, bookings, clients with history and no-show count, services and prices, team schedules and time off, reminders queue, reports, settings.
- Double-booking protection: every write re-checks the slot against the latest state, with optimistic retry on the Blob store.
- Roles: owner, manager, reception, team member, each enforced on the server.
- Arabic and English, full RTL. Cairo time zone handled with Intl (DST-safe).
- Offline: app shell and last loaded views are cached; check-in, complete and note actions queue and sync later.

## Layout
- `lib/core.js` pure rules (slots, conflicts, status flow, reminders, reports, permissions)
- `lib/service.js` API routes, `lib/store.js` Blob/memory store, `lib/seed.js` demo data
- `api/index.js` one Vercel function, `public/` static front end
- `test/` unit tests (`npm test`), `e2e/run.mjs` browser test (`node e2e/run.mjs <url>`)

## Honest limits
- Demo data is shared by all visitors and resets every 6 hours.
- The role picker is not authentication. A real deployment needs sign-in.
- No SMS/WhatsApp/email is sent. The reminders queue shows what would be sent.
- One service per booking. No group classes, packages or recurring bookings.
- Under heavy simultaneous load a write can answer "busy" and the user retries.
- Offline mode does not cover first load or creating new bookings.
