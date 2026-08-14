# Tenant database migrations

`migrations/V001__initial_schema.sql` is the structural baseline copied from
tenant schema `767524024827354`. It creates the nine tenant tables and the
customer-number sequence, but deliberately copies no customer data.

`{{schema}}` is an identifier placeholder. Before executing a migration, the
migration runner must:

1. validate that the org ID contains digits only;
2. replace every `{{schema}}` token with that validated org ID; and
3. execute the migration in a transaction and record its version.

Do not run the SQL file directly without replacing `{{schema}}`.

To inspect the current source schema again:

```bash
node database/scripts/inspect-tenant-schema.js 767524024827354
```

The inspection script reads PostgreSQL metadata only. It does not change the
database and it does not output table rows.

## Provision one customer

```bash
npm run db:provision -- 767524024827355
```

The provisioner locks that org ID, creates `core.tenant_schema_migrations` when
needed, checks migration checksums, and applies only missing versions. Each
migration and its history entry are committed together.

## Upgrade active customers

```bash
npm run db:migrate-all
```

This reads active organization numbers from `core.contractedorg` and upgrades
them with bounded concurrency. Set `MIGRATION_CONCURRENCY` to a value from 1 to
20; the default is 3. A failure for one tenant is reported without preventing
the remaining tenants from being attempted.

Both commands require `DATABASE_URL`. Set `DB_SSL=false` only for a database
that does not use SSL.

The Cloud Run service exposes `POST /pubsub/customer-onboarded`. Connect a
Pub/Sub push subscription to that endpoint and publish a payload such as:

```json
{ "orgid": "767524024827355" }
```
