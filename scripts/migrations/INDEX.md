# scripts/migrations/ index

Numbered SQL migrations. `just migrate` runs them in filename order against the authentik PostgreSQL container. Add new files with the next integer prefix (`003-…`, `004-…`, etc.).

| File | Description |
|---|---|
| `001-gws-uniqueness.sql` | Creates `forest_school_google_sync_uniqueness` side-table and trigger to enforce global uniqueness of google-sync names |
| `002-gws-nested-config.sql` | Migrates side-table and trigger from flat `recursive_name`/`direct_name` keys to nested `recursive.email`/`direct.email`; renames `name` column to `email` |
