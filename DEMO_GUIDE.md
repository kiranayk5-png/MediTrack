# MediTrack: 5-minute college demonstration

## Before the presentation

- Start MySQL 8, then start the backend and frontend using the commands in the README.
- Confirm `http://127.0.0.1:4000/api/health` responds and open `http://127.0.0.1:5173`.
- Use an existing authorized fictional test account. Do not put passwords, cookies, JWTs, or database credentials in slides or screen recordings.
- Prefer a dedicated demo database. Do not complete a sale, dispatch/receive a transfer, submit/approve a reconciliation, or write storage readings against shared or production-like data during the presentation. Use existing records or show the review screens without committing changes.

## 5-minute script and screen order

### 0:00–0:30 — Sign in and frame the problem

“MediTrack is a pharmacy inventory and safety platform. It tracks medicine batches by pharmacy, protects stock movements, and brings expiry, recall, and storage risks into one workspace.”

Sign in with the prepared demo account. Explain that backend permissions and pharmacy assignment are checked on each request.

### 0:30–1:05 — Overview dashboard

Show the real database-backed dashboard. Point out medicine/stock indicators, sales analytics, recent activity, and urgent safety information. Emphasize that charts are based on available API data and may be empty when the database has no observations.

### 1:05–1:45 — Medicines and inventory

Open **Medicines**, search for a catalogue entry, and show its details. Open **Inventory** to explain pharmacy-specific balances, batch numbers, expiry dates, and stock warnings. Describe that manual corrections go through reconciliation review.

### 1:45–2:20 — Point of sale and FEFO

Open **Point of sale** and show pharmacy selection and product lookup. Explain that checkout allocates eligible batches using FEFO (first-expiring, first-out), excludes expired or recalled stock, and commits sale and stock changes transactionally. Do not submit a sale against shared data.

### 2:20–3:00 — Transfers and reconciliation

Show **Stock transfers** and explain source/destination permissions and the request-to-receipt lifecycle. Then open **Inventory reconciliation** and describe physical counts, discrepancy reasons, stale-count checks, independent review, and atomic application after approval. Avoid committing either workflow during the demo.

### 3:00–3:40 — Safety, storage, and notifications

Show **Safety alerts**, **Storage monitoring**, and **Notifications**. Explain that out-of-range readings are evaluated against saved pharmacy policies, and notifications are scoped to the viewer's permitted pharmacy or platform scope.

### 3:40–4:15 — Forecasts and reports

Open **Demand forecasts** and show its historical-sales basis and data-quality labels. Then open **Reports**, select a report type, and demonstrate CSV export if appropriate. Explain that limited history is identified rather than presented as a reliable trend.

### 4:15–4:40 — Staff and audit trail

For a manager/admin account, show **Staff & roles** and **Audit trail**. Explain that privileged pages are protected by backend role checks and the audit view is read-only. A pharmacist account should not be able to access administrator-only endpoints.

### 4:40–5:00 — Architecture and close

“The React/Vite client calls an Express REST API. The API authenticates with bcrypt-verified login and an HttpOnly JWT cookie, revalidates the current user's role and pharmacy assignment, and reads/writes MySQL through parameterized queries. Critical stock workflows use transactions so partial movements roll back.”

Close by summarizing how the system joins inventory accuracy with medicine safety and pharmacy-level accountability.

## Recommended navigation order

1. Overview
2. Medicines
3. Inventory
4. Point of sale
5. Stock transfers
6. Inventory reconciliation
7. Safety alerts
8. Storage monitoring
9. Notifications
10. Demand forecasts
11. Reports and CSV export
12. Staff & roles and Audit trail (authorized roles only)

## Architecture overview

```text
React + Vite browser client
  └─ credentialed REST requests with HttpOnly session cookie
       └─ Express API: validation → authentication → role/pharmacy authorization
            └─ mysql2/promise → MySQL 8 / InnoDB
```

The browser does not define authorization scope. Express loads the active user, current role, and pharmacy assignment from the server-side session and applies route-level scope. Sales, transfers, and approved reconciliation adjustments use database transactions with stock history and audit records.

## Five likely viva questions

**1. How does MediTrack prevent dispensing expired or recalled products?**

The sales API selects eligible batches in FEFO order inside the checkout transaction. It excludes expired and actively recalled stock, locks inventory rows while allocating, and rolls back if sufficient eligible quantity is unavailable.

**2. How is pharmacy isolation enforced?**

The backend derives a scoped user's pharmacy from the current authenticated user record. It does not trust a client-supplied pharmacy ID for ordinary users; route permissions and SQL filters enforce the scope server-side.

**3. How does logout invalidate a copied session token?**

JWTs contain a random session ID (`jti`); the database stores only its SHA-256 hash. Logout marks the matching session revoked, and protected requests require an unrevoked, unexpired session plus an active current user.

**4. Why does reconciliation require independent approval?**

Physical counts can alter stock balances, so a different authorized manager must review submitted discrepancies. Approval rechecks the counted stock snapshot and applies adjustments transactionally; stale counts require resolution instead of overwriting newer movements.

**5. How should a demand forecast be interpreted when sales history is sparse?**

The forecast is calculated from stored historical sales and eligible stock, and it exposes its observation window and data-quality classification. Limited or insufficient history is shown as a limitation; the app does not invent confidence or accuracy values.

## Demo limitations to state honestly

- Browser end-to-end and cross-device visual checks are separate from the automated Jest/Node contract tests; run them in a browser-capable environment before claiming browser verification.
- Barcode lookup identifies a stored catalogue record; it does not authenticate product genuineness.
- Forecast usefulness depends on the amount and quality of real completed-sale history.
- Historical stock movement baselines may be incomplete for older inventory. Do not represent missing history as reconstructed facts.
