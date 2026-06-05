import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Minimal JWT payload decoder (no signature verification — that's the backend's job)
// ---------------------------------------------------------------------------
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const OAuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const storedState = sessionStorage.getItem('oauth_state');
    const verifier = sessionStorage.getItem('pkce_verifier');

    if (!code) {
      const errorParam = params.get('error');
      const desc = params.get('error_description');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        errorParam
          ? `authentik error: ${errorParam}${desc ? ` — ${desc}` : ''}`
          : `No authorization code received. URL params: ${window.location.search || '(none)'}`,
      );
      return;
    }

    if (state !== storedState) {
      setError('OAuth state mismatch. Possible CSRF attack.');
      return;
    }

    if (!verifier) {
      setError('PKCE verifier not found. Please try logging in again.');
      return;
    }

    const baseUrl = import.meta.env.VITE_AUTHENTIK_BASE_URL as string;
    const clientId = import.meta.env.VITE_OIDC_CLIENT_ID as string;
    const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI as string;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });

    // In authentik 2026.x the token endpoint is global (no slug in path).
    fetch(`${baseUrl}/application/o/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Token exchange failed: ${text}`);
        }
        return res.json() as Promise<{
          access_token: string;
          id_token?: string;
          refresh_token?: string;
          expires_in?: number;
        }>;
      })
      .then((data) => {
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

        // Extract user UUID from id_token sub claim
        if (data.id_token) {
          const payload = decodeJwtPayload(data.id_token);
          const sub = typeof payload.sub === 'string' ? payload.sub : null;
          if (sub) {
            sessionStorage.setItem('user_uuid', sub);
          }
        }

        // Clean up PKCE artifacts
        sessionStorage.removeItem('pkce_verifier');
        sessionStorage.removeItem('oauth_state');

        navigate('/me', { replace: true });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-2">Authentication Error</h2>
          <p className="text-sm">{error}</p>
          <button
            className="mt-4 rounded bg-red-600 px-4 py-2 text-white text-sm hover:bg-red-700"
            onClick={() => { window.location.href = '/'; }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">Completing sign-in…</p>
    </div>
  );
};

export default OAuthCallback;
