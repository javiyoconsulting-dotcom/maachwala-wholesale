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
