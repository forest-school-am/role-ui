# docker/ index

| Item | Description |
|---|---|
| `composes/authentik.yml` | Full dev stack: Postgres + Redis + authentik server + worker |
| `composes/app.yml` | App-only deploy compose — pulls GHCR image, needs an external authentik |
| `Dockerfile` | Multi-stage production build (node frontend -> rust backend -> debian slim runtime) |
| `.dockerignore` | Files excluded from the Docker build context |
