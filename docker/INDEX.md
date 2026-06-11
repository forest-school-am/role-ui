# docker/ index

| Item | Description |
|---|---|
| `composes/authentik.yml` | Full dev stack: Postgres + Redis + authentik server + worker |
| `composes/app.yml` | App-only deploy compose -- pulls GHCR image, needs an external authentik |
| `Dockerfile` | Multi-stage production build (node frontend -> rust backend -> debian slim runtime) |
| `.dockerignore` | Files excluded from the Docker build context |
| `.env` | Local secrets (gitignored) -- copy from `.env.example` and fill in |
| `.env.example` | Template for the authentik dev-stack env vars |
| `app.env.example` | Template for the app-only runtime env vars (production deploy) |
