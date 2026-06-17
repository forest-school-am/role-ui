# scripts/ index

| Item | Description |
|---|---|
| `setup-authentik.sh` | Creates the service account and OIDC provider/app; writes API token to `.env`; idempotent |
| `seed-test-data.sh` | Creates 10 test users and several groups via the authentik API |
| `migrations/` | Numbered SQL migrations applied in order by `just migrate` |
| `populate-logins.sql` | Seeds `logins.telegram` from username and `logins.google` from email for all real users |
