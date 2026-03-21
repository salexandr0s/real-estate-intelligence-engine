# Migration Rules

Rules for database migrations in this project. All migrations live in `packages/db/migrations/`.

## Rules

### 1. Never drop columns with production data without a multi-step migration

Dropping a column that contains data requires three steps across separate deployments:

1. **Deploy code that stops writing to the column** — remove all INSERT/UPDATE references
2. **Deploy code that stops reading the column** — remove all SELECT/WHERE references
3. **Drop the column** in a subsequent migration after confirming no code references remain

### 2. Always add new columns as nullable or with defaults

```sql
-- Correct
ALTER TABLE listings ADD COLUMN IF NOT EXISTS new_field TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS new_flag BOOLEAN DEFAULT FALSE;

-- Wrong: will fail if table has existing rows and no default
ALTER TABLE listings ADD COLUMN new_field TEXT NOT NULL;
```

### 3. Never rename columns directly

Renaming breaks all existing queries. Use the add-backfill-drop pattern:

1. Add the new column (nullable)
2. Backfill from the old column: `UPDATE table SET new_col = old_col WHERE new_col IS NULL`
3. Update application code to read/write the new column
4. Drop the old column in a later migration

### 4. Test migrations from both empty and seeded state

Every migration must pass:
- **Forward from empty**: `npm run db:migrate` on a fresh database
- **Forward from seeded**: `npm run db:migrate && npm run db:seed` then apply the new migration

The existing migration test infrastructure verifies both paths (see `tests/integration/migrations.test.ts`).

### 5. Schema file is the single source of truth

The authoritative schema definition is `packages/db/migrations/001-initial-schema.sql`. All table definitions, constraints, indexes, and triggers are defined there.

When adding migrations, keep the initial schema file as the canonical reference for what the final schema looks like. Incremental migrations should be additive.

### 6. All migrations must be idempotent

Use guard clauses so migrations can be re-run safely:

```sql
-- Tables
CREATE TABLE IF NOT EXISTS new_table (...);

-- Columns
ALTER TABLE listings ADD COLUMN IF NOT EXISTS new_field TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_name ON table (column);

-- Functions
CREATE OR REPLACE FUNCTION function_name() ...;

-- Dropping
DROP INDEX IF EXISTS idx_old_name;
ALTER TABLE listings DROP COLUMN IF EXISTS old_field;
```

### 7. Wrap migrations in transactions

```sql
BEGIN;

-- migration statements here

COMMIT;
```

This ensures partial failures don't leave the schema in an inconsistent state.

### 8. Document rollback strategy as a compensating migration

This project does not use down migrations. Every migration must include a comment documenting how to reverse it:

```sql
-- Rollback: DROP INDEX IF EXISTS idx_new_name;
CREATE INDEX IF NOT EXISTS idx_new_name ON listings (new_column);

-- Rollback: ALTER TABLE listings DROP COLUMN IF EXISTS new_field;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS new_field TEXT;
```

For complex migrations, write the compensating migration as a separate file and reference it in the migration comment.

### 9. Naming convention

Migration files follow the pattern: `{NNN}-{description}.sql`

- Sequential numbering (001, 002, 003...)
- Kebab-case description
- Examples: `002-add-listing-tags.sql`, `003-backfill-district-names.sql`
