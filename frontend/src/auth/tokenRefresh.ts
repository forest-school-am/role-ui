import { getConfig } from '../config';

// Singleton: if a refresh is already in flight, reuse the same promise so
// concurrent callers don't each fire an independent refresh request.
let inflightRefresh: Promise<string> | null = null;

/**
 * Exchange the stored refresh_token for a new access token.
 * Updates sessionStorage on success; throws on failure (caller should log out).
 * Returns the new access token.
 */
export async function refreshAccessToken(): Promise<string> {
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = (async () => {
    const refreshToken = sessionStorage.getItem('refresh_token');
    if (!refreshToken) throw new Error('no refresh_token in sessionStorage');

    const { authentikBaseUrl, oidcClientId } = getConfig();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oidcClientId,
    });

    const res = await fetch(`${authentikBaseUrl}/application/o/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`token refresh failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    sessionStorage.setItem('auth_token', data.access_token);
    if (data.refresh_token) {
      sessionStorage.setItem('refresh_token', data.refresh_token);
    }
    if (data.expires_in) {
      sessionStorage.setItem(
        'token_expires_at',
        String(Date.now() + data.expires_in * 1000),
      );
    }

    return data.access_token;
  })().finally(() => {
    inflightRefresh = null;
  });

  return inflightRefresh;
}
