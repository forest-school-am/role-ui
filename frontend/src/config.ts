interface AppConfig {
  authentikBaseUrl: string;
  oidcClientId: string;
  oidcRedirectUri: string;
}

declare global {
  interface Window {
    __CONFIG__?: AppConfig;
  }
}

// In production the backend injects window.__CONFIG__ into index.html.
// In local dev (Vite dev server) fall back to import.meta.env so that
// a local .env file keeps working without any server involvement.
export function getConfig(): AppConfig {
  if (window.__CONFIG__) return window.__CONFIG__;
  return {
    authentikBaseUrl: (import.meta.env.VITE_AUTHENTIK_BASE_URL as string) ?? '',
    oidcClientId: (import.meta.env.VITE_OIDC_CLIENT_ID as string) ?? '',
    oidcRedirectUri: (import.meta.env.VITE_OIDC_REDIRECT_URI as string) ?? '',
  };
}
