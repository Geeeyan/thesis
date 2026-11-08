# Backend

Express 5 API with SQLite (`better-sqlite3`). Routes live in `server/routes`, shared logic in `server/lib`, and auth, rate limiting and error handling in `server/middleware`. The database `server/villa-tjeozabel-app.sqlite` is created on first run. It uses a separate file from the older `villa-tjeozabel.sqlite` database so existing data is not overwritten. Passwords are hashed with bcrypt, tokens expire after 12 hours, and the login/register endpoints are rate limited (booking, payment and upload endpoints have a looser limit).

Requires **Node 22 or newer**. `better-sqlite3` compiles when installed, so you need a C++ toolchain (Windows: Visual Studio Build Tools with "Desktop development with C++"; macOS: `xcode-select --install`; Linux: `build-essential`).

## Deploy on Render with SQLite

The repository includes a Render Blueprint in `render.yaml`. It builds the React app and Express server as one Node web service, listens on Render's assigned `PORT`, and stores the SQLite database and uploads under `/var/data` on a persistent disk. This preserves the current SQLite-based app; it does **not** connect to Neon or convert the database.

1. Push the project to a Git provider supported by Render. Do not commit `.env`; it contains local secrets and is ignored by Git.
2. In Render, create a **Blueprint** from the repository and review the service and disk before applying it. The Blueprint uses Render's paid `starter` service plan because persistent disks require a paid service.
3. Keep the configured disk mount and environment paths together: `DATABASE_PATH=/var/data/villa-tjeozabel-app.sqlite` and `UPLOAD_DIR=/var/data/uploads`. Do not remove the disk or change these paths after real bookings or uploads exist.
4. In the Render service's Environment settings, set `ADMIN_NAME`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` to create the initial admin account. The password is hashed; the seed accounts are only created when the configured email is not already present.
5. Add production email settings (`MAIL_HOST`, `MAIL_PORT`, `MAIL_ENCRYPTION`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`) in Render's Environment settings if the app should send emails. Use a Gmail App Password, never your normal Gmail password. Do not paste credentials into source code or commit them.
6. Deploy, then confirm the Render health check at `/api/health` succeeds and test login, booking, uploads, and email delivery.

This SQLite deployment is for a **single service instance**; do not scale it horizontally. The local filesystem is otherwise ephemeral, so the persistent disk is required for the database and uploaded files. Back up the database and uploads separately before production use. When you are ready to move to Neon, first convert and test the backend's database access and migrate both database data and any files; setting `DATABASE_URL` alone will not make this app use PostgreSQL.

## Run locally

1. Copy `.env.example` to `.env` and set `JWT_SECRET` (32+ random characters; the server refuses to start with the example value). The file shows how to generate one.
2. Optionally set the `ADMIN_*` and `STAFF_*` values. Those accounts are created on start only if the email does not exist yet, so restarting never resets a password.
3. `npm install`, then `npm start`. This builds the React frontend, starts the API on port 4000, and serves the site at `http://localhost:8080`. The default web port is 8080 so it does not require administrator privileges. `npm run build` can be run separately to rebuild the frontend.

For backend auto-restart during development, run `npm run dev`. The repository does not define a React development-server script; `npm start` builds the frontend before serving it.

Settings in `.env`: `API_PORT`, `WEB_PORT`, `FRONTEND_ORIGIN` (allowed CORS origins, comma separated), `DATABASE_PATH`, `UPLOAD_DIR`, `FRONTEND_BUILD_DIR`, `CURRENCY`, `TIMEZONE`, `ARRIVAL_START_HOUR`, `ARRIVAL_END_HOUR`, `SAME_DAY_START_CUTOFF_HOUR`, `PAYMENT_INSTRUCTIONS_EWALLET/BANK`, `TRUST_PROXY`, mail settings (`MAIL_HOST`, `MAIL_PORT`, `MAIL_ENCRYPTION`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`), `MAIL_TIMEOUT_MS`, `MAIL_RETRY_COUNT`, `MAIL_RETRY_DELAY_MS`, and `BOOKING_REMINDER_HOURS`. Legacy `SMTP_*` and `GMAIL_*` variables remain supported. `.env` is ignored by Git.

## Roles

`guest` (public sign-up), `staff`, `admin`. The role is read from the database on every request, so deactivating or demoting someone takes effect immediately, even if their token has not expired. Public registration can only ever create guests.

## Endpoints

| Area | Endpoint | Who |
|---|---|---|
| Health | `GET /api/health` | public |
| Auth | `POST /api/auth/register` `{name,email,password}` | public |
| | `POST /api/auth/login` `{email,password}` → `{token,user}` | public |
| | `POST /api/auth/forgot-password` `{email}` | public; requests a code, always returns the same generic response for registered and unknown email addresses |
| | `POST /api/auth/resend-reset-code` `{email}` | public; invalidates and replaces the previous code, with a 60-second cooldown |
| | `POST /api/auth/verify-reset-code` `{email,code}` | public; consumes a valid code and returns a short-lived reset token |
| | `POST /api/auth/reset-password` `{resetToken,password,confirmPassword}` | public; requires the verified, single-use reset token |
| | `GET /api/auth/me` | any logged-in user |
| Messaging | `POST /api/messages/inquiries` `{name,email,phone?,subject,message}` | public or logged-in guest |
| | `GET /api/messages` | logged-in users see their own threads; staff/admin see all |
| | `GET /api/messages/:id`, `POST /api/messages/:id/replies` | conversation owner, staff/admin, or holder of the inquiry access token |
| | `PATCH /api/messages/:id/change-request` `{decision:"Approved"\|"Declined",note?}` | staff, admin; approves/declines a guest cancellation or reschedule request |
| | `POST /api/messages/payment-proof` `{reservationId,documentId,method,message?}` | logged-in guest who owns the booking |
| Users | `GET /api/users?role=&q=`, `POST /api/users`, `PATCH /api/users/:id` | admin |
| Services | `GET /api/services` (active only) | public |
| | `GET /api/services?includeInactive=true` | admin |
| | `GET /api/services/management?date=YYYY-MM-DD&type=room\|service` (`type` optional) | staff, admin; returns date-specific availability, timed slots, thumbnails, and the caller's permissions |
| | `GET /api/services/:code?date=YYYY-MM-DD` | staff, admin; returns one inventory item with availability |
| | `POST /api/services`, `PATCH /api/services/:code`, `DELETE /api/services/:code` | admin; names are unique, deletion is soft and blocked by upcoming bookings |
| Service photos | `GET /api/services/:code/photos`, `GET /api/services/:code/photos/:id/image` | public; staff/admin may view inactive listings |
| | `POST /api/services/:code/photos`, `PATCH /api/services/:code/photos/:id`, `DELETE /api/services/:code/photos/:id` | admin |
| Availability | `GET /api/availability?room=regular&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD` (`room` optional: omit for all rooms) | public |
| | `GET /api/availability/calendar?room=regular&month=YYYY-MM` or `?room=regular&from=YYYY-MM-DD&to=YYYY-MM-DD` | public; returns dates with no available units |
| Reservations | `POST /api/reservations` | public (token optional, links the booking to the account) |
| | `GET /api/reservations/arrival-times?date=YYYY-MM-DD&room=event` | public; returns start-hour choices with current availability |
| | `GET /api/reservations?status=&room=&from=&to=&q=&limit=&offset=` | logged in: guests see their own, staff/admin see all |
| | `GET /api/reservations/:reference` | public; contact details are hidden unless owner/staff/admin |
| | `PATCH /api/reservations/:id/status` `{status}` | staff, admin |
| Payments | `POST /api/reservations/:reference/payment-intent` `{method:"ewallet"\|"bank"}` | public |
| | `GET /api/payments?status=&reservation=`, `PATCH /api/payments/:id/status` | admin |
| Documents | `POST /api/documents` (multipart: `reservationId`, `document`) | logged in, own reservation or staff |
| | `GET /api/documents?reservationId=`, `GET /api/documents/:id/download`, `DELETE /api/documents/:id` | owner, staff, admin |
| Site images | `GET /api/site-assets`, `GET /api/site-assets/:key` | public |
| | `POST /api/site-assets/:key` (multipart: `asset`), `DELETE /api/site-assets/:key` | admin; JPEG, PNG, or WebP up to 10 MB |
| Staff | `GET /api/staff`, `POST /api/staff`, `PATCH /api/staff/:id` | admin |
| Admin | `GET /api/admin/overview`, `GET /api/admin/management`, `GET /api/admin/notifications` | admin |

Calendar dates use the configured server timezone and represent occupied nights: check-in is occupied, while check-out is available for same-day turnover. Event Space and Entire Villa store a 720-minute duration and same-day checkout rule on their service records. Their start-hour choices stop before `SAME_DAY_START_CUTOFF_HOUR` (12 by default, so 11:00 AM is the latest whole-hour start); the server also verifies that the calculated end timestamp remains on the booking date. New reservations store `start_datetime` and `end_datetime` as UTC ISO timestamps converted from the configured server timezone. There is no separate host-managed calendar block feature.
| Dashboard | `GET /api/dashboard` | staff, admin |
| Reports | `GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` (default: last 30 days, 366 max) | admin |
| | `GET /api/reports/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD&metric=bookings\|revenue&groupBy=category` | admin; Monday-start weeks in the configured `TIMEZONE`, confirmed/completed reservations, eight-week moving-average forecast when the selected range contains at least four weeks with booking history |

Errors are JSON: `{ "error": "message", "details": [...] }`.

## Outgoing email

All outgoing mail uses `server/lib/mailer.js` and one branded HTML layout with a plain-text alternative. Templates cover password reset codes, password-change confirmations, booking receipts and confirmations, reminders, cancellation/reschedule requests, and approved changes. User-provided template values are HTML-escaped. Recipients are validated before sending. SMTP sockets have a timeout; failed delivery is retried up to three times with increasing delays and logs contain only a safe error code, never mail content or credentials. OTP and booking notices run in the background. New bookings receive a request receipt; the guest receives a confirmation when staff confirms it, and cancellation/reschedule notifications when requests are reviewed. Confirmed bookings receive one reminder around `BOOKING_REMINDER_HOURS` before check-in (24 hours by default). The project does not have a durable job queue; the reminder scheduler runs in-process, and a SQLite sent-reminder marker prevents repeat messages.

In development, the `.env.example` defaults to a local Mailpit listener (`127.0.0.1:1025`, web inbox `http://localhost:8025`); run Mailpit locally to capture messages without sending real email. For a test with a configured sender, run `npm run email:test -- recipient@example.com`.

To send through Gmail, edit the project-root `.env`:

1. Turn on **2-Step Verification** for the sending Google account: Google Account → **Security** → **How you sign in to Google** → **2-Step Verification**.
2. Open **Google Account → Security → 2-Step Verification → App passwords** and create an app password. Google displays a 16-character password; copy it when shown. App passwords may be unavailable for some managed accounts or security setups.
3. Set `MAIL_HOST=smtp.gmail.com`, `MAIL_PORT=587`, `MAIL_ENCRYPTION=STARTTLS`, `MAIL_USERNAME` to the full Gmail address, `MAIL_PASSWORD` to the App Password, `MAIL_FROM_ADDRESS` to that same Gmail address, and `MAIL_FROM_NAME=Villa Tjeozabel`. Port 465 uses `MAIL_ENCRYPTION=SSL`.
4. Save `.env` and restart the backend. Never use your regular Gmail password, put credentials in source code, or paste credentials into logs or support messages.

The existing password-reset rate limits remain five requests per hour per IP and normalized email (plus the 60-second resend cooldown). Gmail sending limits are approximately 500 messages/day for consumer accounts and 2,000/day for many Workspace accounts; higher volume requires a transactional email provider. If sending from your own domain, publish an SPF record authorizing your provider, enable DKIM signing and publish the provider's DKIM record, and add a DMARC TXT record at `_dmarc.yourdomain` (start with `p=none` to monitor, then tighten policy after verifying reports). Use the exact DNS values supplied by your mail provider.

The startup migration is additive and idempotent: it adds `users.auth_version` (default `0`) and creates reset-token and hashed-email-rate-limit tables with expiry indexes. It preserves current user, OTP, and session records. Reset increments the auth version and revokes recorded sessions, which also invalidates older signed-in JWTs that predate database-backed session IDs. Password reset requests, failed code attempts, verification, and successful resets are recorded in the existing profile audit log when the account is known.

Contact inquiries are stored as conversations, and staff/admin can reply from the staff Messages inbox. Admin notifications include conversation threads whose latest message is from a guest, so unanswered inquiries and follow-up messages remain visible until staff replies. Anonymous inquiries receive a one-time 256-bit access token in the create response; the browser saves it locally and sends it as `X-Inquiry-Token` when the visitor returns to the contact page. The token is stored only as a hash in SQLite. Inquiries are linked to an account by email so the guest can access the same thread after registering with that email. Conversation messages remain in-app; reservation lifecycle emails are sent separately by the shared mailer.

Guest cancellation and reschedule requests appear in the Messages inbox with review controls. Staff/admin approval cancels the reservation or changes its dates and recalculates the total using current service pricing; reschedules are checked against availability, and pending payment intents are invalidated when the reservation changes. Same-day service requests include the selected start time and apply the same duration, cutoff, and overlap rules. Declining leaves the reservation unchanged. The decision and optional staff note are added to the conversation for the guest to see. Guests receive a request receipt and an email after an approved cancellation or reschedule.

Room and service management permissions are defined centrally in `server/lib/permissions.js`: admins can view/create/update/delete, staff can view only, and guests cannot use the management endpoint. Admin navigation has separate Rooms and Services inventory views; the shared screen provides date-based availability, filters, sorting, pagination, summaries, and timed-service slots. Staff retain the combined view-only inventory. Photo upload, edit, reorder, and delete use the same admin-only server checks. Management changes, photo changes, and denied permission attempts are recorded in the existing profile audit log. Deletion is soft (sets the item inactive) so booking history and reports retain the item; deletion requests are blocked while upcoming bookings exist and include booking references.

Admins can update the e-wallet QR code, landing hero, and service/room photos in Settings → Site Media. Uploaded images are validated by file signature, stored outside the public build folder, and served from the public site-assets endpoint. Removing a custom image restores the built-in frontend default.

### Creating a reservation

```json
POST /api/reservations
{ "guestName": "Ana Cruz", "guestEmail": "ana@example.com", "guestPhone": "0917...",
  "room": "regular", "checkIn": "2026-12-20", "preferredTime": "14:30",
  "checkOut": "2026-12-23", "guests": 2,
  "notes": "Late arrival" }
```
The reservation form asks for a preferred check-in time. `preferredTime` uses 24-hour whole-hour `HH:00` format; it remains optional for services without a timed same-day rule, and is required for Event Space and Entire Villa. For those two services, send `checkOut` equal to `checkIn`; the server rejects a different date, ignores client-sent checkout-time values, and calculates checkout from the saved service duration. `guestName`/`guestEmail` can be left out when logged in. The response includes `reference` (for example `VT-K7M2Q9XA4P`), the saved `preferredTime`, calculated `checkOutTime`, and the **server-calculated** `total`. Prices always come from the database, never from the request. Stays are 1 to 30 nights, check-in cannot be in the past, and `guests` cannot exceed the room's capacity. Check-out day can be another guest's check-in day. Availability is rechecked in an immediate SQLite transaction when a reservation is created, so competing requests cannot claim the last unit simultaneously.

When someone books without logging in, their name and email are also saved as a guest record in `users`; these records do not have login access. If they later register with that email, the record becomes a regular guest account. Their earlier anonymous reservations remain unlinked and are not exposed through the account.

### Status workflow

`Pending → Confirmed | Cancelled`, `Confirmed → Checked-in | Completed | Cancelled`, `Checked-in → Completed`. `Completed` and `Cancelled` are final. Pending, confirmed, and checked-in reservations occupy inventory; cancelling frees it. Customer Walk-in pending holds expire after 24 hours if unpaid. Regular online pending reservations currently have no automatic expiry.

### Services

Only rooms and bookable spaces are offered as services. The `inventory_type` field separates overnight accommodations from bookable services while `category: "room"` continues to identify inventory that can be reserved. The idempotent additive schema migration adds `inventory_type` with a `room` default and classifies existing Private Pool (`pool`) and Event Space (`event`) rows as `service`; other existing/custom inventory remains `room`. It does not change prices, reservations, or bookings. A fresh database is seeded with Regular Room, Luxury Room, Entire Villa, Private Pool, and Event Space. Existing add-on catalogue entries and the family room are retired at startup; saved reservation history is preserved. New reservations cannot include add-ons or book the retired family room. A service with a nonzero duration must enable same-day timed booking, which makes start-time availability and overlap validation use that duration. Change room prices and quantities with `PATCH /api/services/:code`; existing reservation totals remain saved as booked.

### Payments

A payment intent is recorded as **Pending** only, for the remaining balance, and returns the instructions from `PAYMENT_INSTRUCTIONS_*`. Repeating the same request returns the same pending intent. An admin reconciles it (`Pending → Paid | Failed`, `Paid → Refunded`, `Failed → Pending`) once the money has really arrived. Marking a payment Paid is refused if it would take the reservation past its total. A payment provider with a verified webhook is required for automatic confirmation. Card details must never be sent to this API, and any request containing card-like fields is rejected.

On the guest dashboard, a signed-in guest can request payment instructions and submit a JPEG, PNG or WebP screenshot (up to 10 MB) for their own booking. The proof is added to a payment conversation visible to staff and admins. Admins can review the screenshot and confirm the payment from that conversation; confirmation uses the same payment-status workflow above. Uploading a screenshot never confirms payment by itself.

### Documents

PDF, JPEG, PNG and WebP up to 10 MB, max 10 per reservation. The file type is checked from the file's contents, not its name. Files are stored in `server/uploads` (outside the web root), under random names. Downloads need access to the reservation, and someone without access gets "not found". Guests can only upload to reservations linked to their own account, so for guests to attach documents they should be logged in when booking.

## Verify

`npm run test:api` runs the API regression suite against a temporary SQLite database and uploads folder, which are deleted when it finishes. It covers same-day checkout calculations, cutoff validation, time-based overlap handling, and rescheduling in addition to the existing auth, pricing, inventory, privacy, payments, staff, and reporting flows.
