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

### 5. Migrations are the source of truth

Real databases are built only by the files in `packages/db/migrations/`, applied in filename order. An applied file never changes: the runner stores a checksum for each file and refuses to run when one differs. Fix a mistake with a new migration.

`schema.sql` at the repo root is the whole schema in one file, for reading. It is generated from the migrations, so regenerate it in the same change as a new migration and commit both:

```bash
SCHEMA_ADMIN_URL=postgres://<user>@<host>:<port>/postgres npm run db:schema
```

The server needs CREATEDB rights; the script builds a scratch database, dumps it and drops it. The integration suite fails when `schema.sql` and the migrations disagree.

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

### 7. Let the runner own the transaction

The runner applies each file inside one transaction and records it in `_migrations` in that same transaction, so a failed file leaves nothing behind. Don't write `BEGIN` or `COMMIT` in a migration: a `COMMIT` would end the runner's transaction early. Start every file with:

```sql
SET LOCAL statement_timeout = 0;
```

The pool's statement timeout (10 s by default) applies to migrations too, and a backfill on real data can take longer. `SET LOCAL` ends with the transaction.

Some early files (001 and 005 to 008) still contain `BEGIN` and `COMMIT`. They are applied everywhere, so they stay as they are.

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
