# MediTrack

MediTrack is a pharmaceutical inventory and safety MVP for pharmacy teams. The application uses a React/Vite frontend, an Express REST API, and MySQL 8. The current local database name is `meditrack_db`.

## Architecture

```text
React + Vite (5173)
  └─ REST calls with credentials: include; HttpOnly session cookie
       └─ Express API (4000)
            └─ mysql2/promise pool → MySQL 8 (`meditrack_db`)
```

- `frontend/src`: routed application pages, responsive dark purple UI, Recharts analytics, barcode camera/manual lookup, and shared API client.
- `backend/src`: Express app, cookie/JWT authentication, role checks, pharmacy scope middleware, parameterized SQL routes, and centralized errors.
- `database/schema.sql`: 18 InnoDB tables for users, catalogue, pharmacy batches and balances, sales, safety events, transfers, forecasts, and audit history.
- `database/seed.sql`: fictional development data with bcrypt-compatible password hashes. It contains no plaintext demo passwords.

## Technology stack

- Frontend: React 18, Vite, React Router, Tailwind CSS utilities, Recharts, and Lucide React.
- Backend: Node.js, Express 4, JavaScript, REST endpoints, and `mysql2/promise`.
- Database: MySQL 8 with InnoDB tables and transactional stock operations.
- Security: bcryptjs password hashing, HS256 JWTs in HttpOnly cookies, SHA-256 hashed session IDs in the server-side session registry, role checks, pharmacy scoping, origin checks for browser mutations, and parameterized SQL.
- Quality: Jest and Supertest for backend tests; Node's test runner for frontend contract and presentation tests.

## Implemented features

- Login/logout with bcrypt password checks and JWTs in HttpOnly cookies. Persistent server-side sessions support logout revocation; each request reloads the active user's role and pharmacy assignment. Mutations reject a mismatched browser origin; login is rate limited.
- Four roles: `platform_admin`, `pharmacy_manager`, `pharmacist`, and `inventory_clerk`. Non-admin pharmacy scope is derived from the authenticated session on the backend.
- Database-backed dashboard metrics, sales trend, stock mix, and recent audit activity.
- Medicine catalogue create, edit, view, search, pagination, and identifier management. Batch receiving creates the batch, inventory balance, and stock history in one transaction.
- Pharmacy inventory listing and batch history. Manual physical corrections use reconciliation and independent manager approval; sales, batch receiving, and transfers retain their dedicated transactional movement workflows.
- Pharmacy-scoped supplier listing, creation, and update.
- Point of sale with a searchable pharmacy picker for platform admins and session-assigned pharmacy for scoped users. Sales lock and allocate non-expired, non-recalled batches in FEFO order and commit sale lines, inventory deductions, stock history, and audit event together.
- Barcode camera scanning where browser permissions and hardware allow, plus manual entry. Lookup checks stored identifiers and pharmacy batches; it does not authenticate product authenticity.
- Expiry, low-stock, and recall views; inventory and sales reports; CSV exports with spreadsheet-formula neutralization.
- Inter-pharmacy transfers with separate request, approval, dispatch, receipt, rejection, and cancellation steps. Dispatch and receipt update inventory, movement history, and audit rows transactionally; destination receipt creates or matches a destination batch.
- Staff directory and role administration with backend role checks, pharmacy scoping, password hashing, no hash exposure, and self-lockout safeguards.
- Pharmacy storage policies and condition logs with range checks and explicit alerts. Readings without a configured policy are marked unevaluated rather than compliant.
- Demand forecasts derived from completed historical sales and current eligible stock. Each result reports its observation window, data-quality label, and method; sparse history is visibly marked limited or insufficient.
- Scoped audit trail and CSV-capable inventory, sales, transfer, storage, and forecast reports.
- Notification center with pharmacy-scoped expiry, low-stock, transfer-state, and storage-condition alerts; unread badge, category/severity/read-state filters, pagination, and safe read acknowledgements. A CSRF-origin-checked POST refresh idempotently materializes events; feed and count endpoints are read-only.
- Inventory reconciliation with batch-level physical counts, signed discrepancy calculations, reason codes, saved drafts, immutable submission state, manager approval/rejection, self-approval prevention, stale-snapshot detection, transactional stock-history entries, and audit events.

The additive migrations at `database/migrations/001_operational_modules.sql`, `database/migrations/002_notifications.sql`, `database/migrations/003_inventory_reconciliation.sql`, `database/migrations/004_auth_sessions.sql`, and `database/migrations/005_auth_session_cleanup_index.sql` create supporting workflow tables and indexes. Migration 004 adds the persistent `auth_sessions` registry; migration 005 adds its revoked-session cleanup index. Apply unapplied migrations only after a verified backup and explicit approval. Do not re-run seed data over an existing database.

## Role-based access

- `platform_admin`: platform-wide views and administration; may select an authorized pharmacy where a workflow requires one.
- `pharmacy_manager`: management tools and operational data scoped to the manager's assigned pharmacy; manager review is required for submitted reconciliation adjustments.
- `pharmacist`: permitted day-to-day pharmacy operations, including dispensing and safety workflows; cannot access management-only staff or audit endpoints.
- `inventory_clerk`: permitted inventory tasks for the assigned pharmacy; cannot perform administrator-only actions or point-of-sale transactions.

The backend rechecks the current user's active status, role, and pharmacy assignment for every authenticated request. Frontend route/menu restrictions are for usability and do not replace server authorization.

## Screenshots

Add current captures here after launching the local application. Use fictional or approved demo data and remove any personal or operational information before sharing.

- **Overview dashboard:** _Screenshot placeholder — `docs/screenshots/dashboard.png`_
- **Inventory and batch detail:** _Screenshot placeholder — `docs/screenshots/inventory.png`_
- **Point of sale:** _Screenshot placeholder — `docs/screenshots/point-of-sale.png`_
- **Safety and notifications:** _Screenshot placeholder — `docs/screenshots/safety-notifications.png`_
- **Mobile navigation:** _Screenshot placeholder — `docs/screenshots/mobile-navigation.png`_

## Local setup (Windows PowerShell)

Requirements: Node.js 20+, npm, and MySQL 8.

1. From PowerShell, configure backend settings. The example uses local development values; replace the database password and generate a private JWT secret. Do not commit `backend/.env`.

   ```powershell
   Set-Location E:\MediTrack
   Copy-Item backend\.env.example backend\.env
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   notepad backend\.env
   ```

   Set `DB_USER`, `DB_PASSWORD`, and `JWT_SECRET`. The example points at `meditrack_db` and `127.0.0.1`. Keep `COOKIE_SECURE=false` for local HTTP only. Use HTTPS and secure cookies when deployed.

2. If setting up a **new empty database**, create it and load schema in dependency order:

   ```powershell
   mysql --user=root --password --execute="CREATE DATABASE IF NOT EXISTS meditrack_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
   mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/schema.sql"
   ```

   `schema.sql` uses `CREATE TABLE IF NOT EXISTS`. It does not migrate mismatched existing table definitions.

3. For a fresh database, apply additive migrations manually in order after checking the database and taking a verified backup. For an existing database, first confirm which migrations are already applied and obtain approval before running any. The backend requires migration 004 for persistent sessions; migration 005 adds the cleanup index. This project never applies migrations automatically. Example PowerShell commands (run only for migrations approved for that database):

   ```powershell
   mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/001_operational_modules.sql"
   mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/002_notifications.sql"
   mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/003_inventory_reconciliation.sql"
   mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/004_auth_sessions.sql"
   mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/005_auth_session_cleanup_index.sql"
   ```

   Existing JWTs without registered sessions will no longer authenticate after the backend update, so users must sign in again. Logout revokes the specific session; account deactivation and role/pharmacy changes are picked up on the next authenticated request.

4. For a **fresh, empty database only**, import the fictional fixed-ID seed. Do not import it over your current database or existing rows; the script is not an upsert and may collide with existing IDs.

   ```powershell
   mysql --default-character-set=utf8mb4 --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/seed.sql"
   ```

   Seed accounts use bcrypt hashes; no demo plaintext password is published. Local demo credentials must be provisioned privately before presenting. The optional `backend/reset-demo-password.local.js` helper is intentionally git-ignored and is not included in a public checkout.

## Production deployment (Vercel, Render, and MySQL 8)

Deployment is manual. Do not import `database/seed.sql` into a production database. Create production users through an approved secure provisioning flow; never reuse development credentials.

### Vercel frontend

- Root Directory: `frontend`
- Framework preset: Vite
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`
- Set `VITE_API_URL` to the public HTTPS API base URL, including `/api` (for example, `https://api.example.com/api`). `VITE_*` values are bundled into client JavaScript and must never contain secrets.
- `frontend/vercel.json` rewrites app routes to `/index.html` so React Router routes survive direct navigation and refresh.

### Render backend

- Create a Web Service with Root Directory `backend`, Build Command `npm install`, and Start Command `npm start`.
- Set `NODE_ENV=production` and `HOST=0.0.0.0`. Render provides `PORT`; the server listens on that port. Local development retains `127.0.0.1` unless `HOST` is explicitly set.
- Set `FRONTEND_ORIGIN` to the exact HTTPS origin of the deployed frontend (scheme and host only, no path). Credentialed CORS is restricted to this origin; do not use `*` or an unrestricted origin callback.
- Set `COOKIE_SECURE=true`. Set `COOKIE_SAME_SITE=none` when the frontend and API are cross-site. `SameSite=None` requires Secure cookies. Prefer custom frontend/API subdomains under one site where possible; browsers may restrict third-party cookies for unrelated Vercel/Render domains.

### Cloud MySQL 8

- Create a MySQL 8 database and a restricted runtime user. Permit network access only from the backend service/provider-approved egress addresses. Use a separate migration/admin identity for DDL; do not run the API as a database owner.
- Apply `database/schema.sql` to the empty database, then manually apply these reviewed migrations in order: `database/migrations/001_operational_modules.sql`, `002_notifications.sql`, `003_inventory_reconciliation.sql`, `004_auth_sessions.sql`, and `005_auth_session_cleanup_index.sql`. Confirm the migration state first and take a verified backup. The application never runs migrations automatically.
- Configure verified TLS: set `DB_SSL=true`, and, when the provider requires a custom CA, set exactly one of `DB_SSL_CA` (provider CA PEM text) or `DB_SSL_CA_FILE` (path to the CA certificate available to the Render service). TLS uses at least TLS 1.2 and rejects untrusted certificates; there is no insecure verification bypass. Production startup fails if `DB_SSL` is false.
- Never import `database/seed.sql` into production. It contains fixed-ID fictional development accounts and public password hashes.

### Environment variables

Set backend values in Render’s environment settings, never in Git:

- Required: `NODE_ENV`, `HOST`, `PORT` (provided by Render), `FRONTEND_ORIGIN`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `DB_SSL`.
- TLS CA (optional when the database certificate chains to Node’s trusted CA store): `DB_SSL_CA` or `DB_SSL_CA_FILE`, but not both.
- Authentication/cookie: `JWT_EXPIRES_IN`, `COOKIE_SECURE`, `COOKIE_SAME_SITE`.
- Pool/session cleanup controls: `DB_CONNECTION_LIMIT`, `AUTH_SESSION_CLEANUP_RETENTION_DAYS`, `AUTH_SESSION_CLEANUP_BATCH_SIZE`.

Set only `VITE_API_URL` in Vercel. Generate a unique high-entropy `JWT_SECRET`; do not copy the local secret. `backend/.env.example` and `frontend/.env.example` contain local placeholders and comments, not deployment credentials.

The browser API client sends `credentials: 'include'`. The backend returns credentialed CORS headers only for `FRONTEND_ORIGIN` and requires an exact matching `Origin` on browser state-changing requests. Explicit non-browser clients without an `Origin` must send `X-MediTrack-Client: non-browser`; this marker does not authenticate the request and should only be used by trusted API clients. Requests with a mismatched Origin are rejected.

No cloud service, database, migration, or deployment has been configured or verified by this repository change. After configuration, verify HTTPS login/logout, cookie persistence in supported browsers, cloud MySQL TLS, restricted database privileges, and deep-link refreshes in the deployed environment.

## Authentication session maintenance

Session cleanup is an explicit one-shot command; the API does not start a timer or run cleanup during login or authenticated requests. This keeps cleanup failures isolated from user traffic and avoids unmanaged background jobs. The command requires migration 004 (`auth_sessions`); migration 005 adds an index for efficient revoked-session cleanup and should be applied first for larger session tables. Neither migration is run by the application.

Set optional cleanup controls in `backend/.env`:

- `AUTH_SESSION_CLEANUP_RETENTION_DAYS` defaults to `30` and accepts `1`–`3650`. Revoked rows at or before this age can be removed.
- `AUTH_SESSION_CLEANUP_BATCH_SIZE` defaults to `500` and accepts `1`–`5000`. Each invocation deletes at most this many expired rows and this many sufficiently old revoked rows.

Run one bounded cleanup pass manually from PowerShell:

```powershell
Set-Location E:\MediTrack\backend
node src\scripts\cleanup-auth-sessions.js
if ($LASTEXITCODE -ne 0) { throw "Session cleanup failed with exit code $LASTEXITCODE" }
```

For deployment, schedule this command with the deployment platform’s job scheduler or Windows Task Scheduler (for example, daily). Configure the task to use `backend` as its working directory and the same restricted database credentials/environment as the API. Monitor the task’s exit code/history and its structured completion output (`expiredDeleted`, `revokedDeleted`, `retentionDays`, `batchSize`). A non-zero exit indicates failure; the script intentionally emits no SQL details or credentials. If either deletion count repeatedly equals the batch limit, increase the run frequency or plan additional bounded passes. Cleanup deletes expired sessions and old revoked sessions only; it cannot select an unrevoked, unexpired session.

5. Install and start backend and frontend in separate PowerShell windows:

   ```powershell
   Set-Location E:\MediTrack\backend
   npm install
   npm run dev
   ```

   ```powershell
   Set-Location E:\MediTrack\frontend
   Copy-Item .env.example .env
   npm install
   npm run dev
   ```

   The frontend is served at `http://127.0.0.1:5173`, the API at `http://127.0.0.1:4000`, and health check at `http://127.0.0.1:4000/api/health`. The frontend API client includes cookies and aligns loopback hostnames so `localhost`/`127.0.0.1` mismatch does not split local cookies.

   For a checkout where dependencies are already installed, the concise start commands are:

   ```powershell
   Set-Location E:\MediTrack\backend
   npm run dev
   ```

   ```powershell
   Set-Location E:\MediTrack\frontend
   npm run dev
   ```

## Test and build commands

These tests mock database access and do not modify MySQL. Run them from PowerShell:

```powershell
Set-Location E:\MediTrack\backend
npm test
Set-Location E:\MediTrack\frontend
npm test
npm run build
```

The session-store cleanup tests also use a mocked database pool. The cleanup command has not been run against the configured database as part of these checks.

Latest automated verification in this workspace:

- Backend: 114 tests passed across 16 suites, including mocked database access and deployment security configuration. Tests do not change MySQL records.
- Frontend: 45 tests passed. Coverage includes deployment rewrite and credentialed API configuration, API-host handling, checkout payloads, reconciliation discrepancy/reviewer rules, role routing, pharmacy labels, notification filters/read actions, and mobile layout contracts. These are automated source/contract tests, not browser tests.
- Production build: `vite build` passed.
- Session cleanup uses MySQL time for both expiry and revoked-session retention cutoffs. Tests mock the database and do not execute cleanup.

## Known limitations

- Seed user identities use fictional `.test` email domains and only bcrypt hashes are stored, but those hashes are public fixtures. Use seed data only in a disposable local database and never reuse demo passwords for real accounts.
- Storage policy/condition and persisted forecast explanation features require migration 001 where it is not already installed. Notifications require migration 002. Live notification refresh and browser behavior must be verified after migration approval/application.
- The prior read-only audit found 15 of 17 inventory rows without a stock-history baseline. No historical records were fabricated or backfilled. Establish baselines through a separately approved, documented reconciliation exercise; do not infer old movements from current balances.
- Cookie-authenticated state-changing requests require the configured Origin or the explicit non-browser client marker. Production config requires an HTTPS frontend origin, `COOKIE_SECURE=true`, and `DB_SSL=true`. Cross-site cookie behavior still needs browser verification on the selected hosting domains.
- Medicine catalogue records are global; pharmacy-specific balances and batches are scoped. The schema has no separate medicine category field, so dosage form is used where category-like classification is shown.
- Barcode scanning requires camera permission and browser support. Manual barcode entry is available; no external authenticity service is integrated.
- Password reset is a local development helper, not an account recovery workflow.
- Cloud provider settings, database TLS CA selection, network allowlists, migrations, backups, and deployed browser behavior remain operator-configured and unverified.

## Future enhancements

- Add browser-based end-to-end coverage for role-specific flows, session replay rejection, keyboard interaction, and responsive layouts.
- Add a dedicated restricted cleanup database account and deployment-managed scheduling after operational approval.
- Establish missing historical stock-history baselines through approved physical reconciliation; do not fabricate past movements.
- Consider an external medicine authenticity service only if a trusted provider and verification workflow are selected.
- Add production hosting, HTTPS, monitoring, backups, and environment-specific operational runbooks before deployment.
