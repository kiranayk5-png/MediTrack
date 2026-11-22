# MediTrack DBMS and workflow SQL notes

## DBMS assumptions

- Target: MySQL 8 with InnoDB and `utf8mb4`.
- The current database is `meditrack_db`; backend SQL uses `mysql2/promise` prepared statements.
- `schema.sql` remains the original 18-table base. This workflow implementation does not edit seed data or the existing schema.
- Pharmacy-specific facts use `pharmacy_id` in joins and predicates. The Express authorization layer binds the pharmacy from the verified JWT for scoped users.
- Quantities are integer units; monetary batch and sale values use `DECIMAL`.

## Additive workflow migration

`migrations/001_operational_modules.sql` adds only:

- `storage_policies`: configured temperature/humidity ranges per pharmacy, with pair, order, and humidity-bound checks.
- `storage_condition_details`: structured storage condition and notes linked to an existing `storage_logs` row.
- `forecast_explanations`: sales lookback, days with sales, data-quality grade, and plain-language formula explanation linked to a `forecast_results` row.

The migration uses `CREATE TABLE IF NOT EXISTS`, adds no columns to current tables, and contains no `DROP`, `TRUNCATE`, or data rewrite. It has **not been run as part of this implementation**. Storage policies/log conditions and persisted forecast explanations require these tables. Apply it only after explicit approval and after reviewing a current backup.

```powershell
Set-Location E:\MediTrack
mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/001_operational_modules.sql"
```

This command is documented for a future approved migration; it was not run by the implementation agent.

## Inventory reconciliation migration

`migrations/003_inventory_reconciliation.sql` adds `inventory_reconciliation_sessions` and `inventory_reconciliation_items` only. Sessions record pharmacy scope, creator, submission/review state, and reviewer notes. Item rows snapshot system quantity, inventory update time, and latest stock-history ID; `discrepancy` is a stored generated value (`physical_quantity - system_quantity`). Composite foreign keys bind each item to the session pharmacy and an existing pharmacy/batch inventory balance. No existing tables or rows are altered by the migration.

The API snapshots stock when a draft starts. Submission requires every row to be counted and every discrepancy to have a reason; `other` requires an explanation. Approval locks the submitted session and affected inventory rows, then compares quantity, update timestamp, and latest history ID with the snapshot. A mismatch commits a `stale` state and applies no stock change. A clean approval updates all changed balances, inserts `adjustment` rows into `stock_history`, updates the session, and writes the audit event in one transaction. Rejection updates only review state and audit history.

The reconciliation migration is **not applied by the application or this implementation**. Apply it only after reviewing the SQL and obtaining approval:

```powershell
Set-Location E:\MediTrack
mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/003_inventory_reconciliation.sql"
```

The command above is an instruction for a later approved activation; it was not executed here.

## Transfer accounting

1. A request stores source pharmacy, destination pharmacy, source batch, quantity, and requester. Request creation checks that the pharmacies differ, both are active, the source batch has enough stock, the batch is in date, and its recall flag is explicitly clear. A request does not reserve or deduct stock.
2. Dispatch locks the transfer and source inventory row in one transaction, repeats quantity/expiry/recall validation, subtracts the units, writes `transfer_out` history, changes status to `in_transit`, and writes an audit event.
3. Receipt locks the transfer, checks source and destination recall scope, creates or matches the destination pharmacy batch, adds destination inventory, writes `transfer_in` history, changes status to `received`, and writes an audit event in one transaction.
4. Source managers may cancel an unshipped transfer. An in-transit cancellation returns the units to source stock and records a compensating `transfer_in` movement. Destination managers may reject requests before dispatch.

The destination batch keeps the source lot number and expiry/price details. If that lot already exists at the destination with conflicting details, receipt is rejected. Foreign keys enforce source batch/pharmacy and movement-to-transfer consistency.

## Storage evaluation

Storage limits are configured per pharmacy; the system does not prescribe clinical ranges. Temperature/humidity measurements are checked only when their corresponding complete range has been configured. Otherwise `is_within_range` is `NULL` and the UI reports “Not evaluated,” not “Within range.” Any configured reading outside range or any non-normal condition is shown in the storage alert view. Log, condition detail, and audit entry share a transaction.

## Forecast method and limitations

The MVP uses completed `sales` and `sale_items` only. Voided/refunded sales are excluded. For each medicine:

```text
daily_rate = completed_units_sold_in_lookback / calendar_lookback_days
predicted_demand = daily_rate * forecast_horizon_days
recommended_reorder = ceil(max(predicted_demand - eligible_on_hand, 0))
```

Eligible on-hand excludes expired and recalled batches. A forecast records `sma-v1` plus a linked explanation. Fewer than 3 sales days is graded `insufficient`; 3–9 is `limited`; 10+ is `adequate`. No forecast row is written when the selected window has no completed sales. This simple average does not model seasonality, lead time, promotion effects, or safety-stock policy and must not be treated as a validated procurement model.

## Authorization and audit

- Platform admins may select locations; pharmacy managers and staff are scoped to their JWT pharmacy.
- Transfer dispatch/approval requires source-pharmacy authority; receipt/rejection requires destination-pharmacy authority.
- Staff management is limited to platform admins and pharmacy managers. Managers cannot grant platform-admin access or manage accounts outside their pharmacy. Passwords are bcrypt hashes; API responses never select the hash.
- Audit search is limited to platform admins and pharmacy managers and filtered server-side by pharmacy. Operational writes record a minimal action, entity, actor, pharmacy, and non-secret details.
- CSV exports use the existing formula-neutralizing serializer.

See [erd.md](erd.md) for the core and additive workflow relationships.

## Notification center migration

`migrations/002_notifications.sql` creates the `notifications` table with a unique event key and indexes for pharmacy-scoped feed/unread queries. It contains no destructive statements and has **not** been applied during this implementation. The notification API derives expiry, low-stock, transfer-state, and storage violations from existing operational rows through an authenticated POST refresh and idempotent upserts; GET feed/count endpoints remain read-only. Read markers are scoped to the authorized pharmacy; platform admins may request platform-wide results. Apply only with explicit approval:

```powershell
Set-Location E:\MediTrack
mysql --user=root --password --database=meditrack_db --execute="source E:/MediTrack/database/migrations/002_notifications.sql"
```
