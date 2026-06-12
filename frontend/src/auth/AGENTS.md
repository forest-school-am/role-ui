# frontend/src/auth/ — authentication and session management

OIDC / PKCE flow against authentik. The frontend acts as a public
client: no client secret, code verifier stored in sessionStorage.

## Token lifecycle

1. `AuthContext` triggers `login()` → redirects to authentik's authorize URL.
2. `OAuthCallback` exchanges the code for tokens via the token endpoint.
3. Tokens are stored in `sessionStorage`: `auth_token`, `refresh_token`,
   `token_expires_at` (ms epoch), `user_uuid`.
4. `AuthContext` schedules a proactive refresh ~60 s before expiry via
   `scheduleRefresh()`. On mount it attempts a silent refresh if the
   stored token is already expired.
5. `tokenRefresh.ts` is the single place that calls the token endpoint.
   It deduplicates concurrent refresh requests via a singleton in-flight
   promise so that simultaneous 401 retries don't each fire a separate
   refresh.
6. `client.ts` (in `api/`) intercepts 401 responses, calls
   `refreshAccessToken()`, and retries the original request once.

## Adding new session state

Store it in `sessionStorage` (not localStorage — clears on tab close)
and clear it in `AuthContext.logout()`.
