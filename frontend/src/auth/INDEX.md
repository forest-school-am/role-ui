# frontend/src/auth/ index

| Item | Description |
|---|---|
| `AuthContext.tsx` | OIDC/PKCE auth provider; login(), logout(), proactive token refresh |
| `tokenRefresh.ts` | Calls the refresh_token grant; deduplicates concurrent refresh attempts |
| `OAuthCallback.tsx` | Handles /auth/callback; exchanges code for tokens, stores in sessionStorage |
| `SuperuserContext.tsx` | Superuser mode toggle — propagates `x-as-superuser` header via context |
| `useAuth.ts` | Convenience hook — `const { token, login, logout } = useAuth()` |
