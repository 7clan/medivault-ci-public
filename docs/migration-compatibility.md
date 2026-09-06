# Migration Compatibility Notes

## M4 Migrations: IF NOT EXISTS / DO $$ Guards

The M4 migration files (`20250729000000_m4_auth_session_device` and `20250730000000_m4_auth_hardening`) use `IF NOT EXISTS` and `DO $$` conditional guards in their SQL.

### Why These Guards Exist

These migrations were originally developed against a development database that had partial schema applied via `prisma db push` before versioned migrations were adopted. The conditional guards were necessary to make the migrations idempotent against that pre-existing schema.

### Policy for Future Migrations

**Future migrations MUST NOT use broad `IF NOT EXISTS` or `DO $$` guards.** All new migrations should use plain DDL statements:

```sql
-- Correct: plain DDL
ALTER TABLE "User" ADD COLUMN "newColumn" TEXT;

-- Incorrect: conditional guard
DO $$ BEGIN
  IF NOT EXISTS (...) THEN
    ALTER TABLE "User" ADD COLUMN "newColumn" TEXT;
  END IF;
END $$;
```

### Rationale

1. **Immutability**: Applied migrations should never change. Conditional guards hide schema drift.
2. **Drift detection**: Plain DDL fails immediately on unexpected schema, alerting operators.
3. **Strict deployment**: `prisma migrate deploy` should fail-fast on any mismatch, not silently skip.

### Exception

The only acceptable use of `IF NOT EXISTS` is for `CREATE INDEX` statements, which are inherently idempotent and safe:

```sql
CREATE INDEX IF NOT EXISTS "SomeTable_someColumn_idx" ON "SomeTable"("someColumn");
```
