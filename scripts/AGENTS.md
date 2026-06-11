# scripts/ — SQL migrations and shell automation

Scripts are run against the local Docker stack. SQL scripts target the Postgres container via `docker exec`; shell scripts call the authentik HTTP API.

**SQL scripts** are applied with `just authentik migrate` or referenced directly in just recipes. They operate on the authentik database (`authentik_core_user`, etc.).

**Shell scripts** use the authentik REST API and require `AUTHENTIK_API_TOKEN` or `AUTHENTIK_BOOTSTRAP_TOKEN` in the environment.

## Adding a new SQL migration

1. Create a new `.sql` file with a descriptive name.
2. Add a recipe to `authentik.just` that pipes it through `docker compose exec -T postgresql psql ...`.
3. Document the file in this folder's `INDEX.md`.
