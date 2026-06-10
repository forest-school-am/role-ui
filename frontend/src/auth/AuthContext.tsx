import React, { createContext, useEffect, useState } from 'react';
import { getConfig } from '../config';

interface AuthContextValue {
  token: string | null;
  userUuid: string | null;
  login: () => void;
  logout: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components -- context files intentionally export non-components
export const AuthContext = createContext<AuthContextValue>({
  token: null,
  userUuid: null,
  login: () => undefined,
  logout: () => undefined,
});

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateRandomBase64Url(length: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem('auth_token'),
  );
  const [userUuid, setUserUuid] = useState<string | null>(() =>
    sessionStorage.getItem('user_uuid'),
  );

  // On mount: if the stored token has already expired, clear session and redirect.
  useEffect(() => {
    const expiresAt = sessionStorage.getItem('token_expires_at');
    if (expiresAt && Date.now() > parseInt(expiresAt, 10)) {
      sessionStorage.clear();
      window.location.href = '/';
    }
  }, []);

  const login = async () => {
    const { authentikBaseUrl: baseUrl, oidcClientId: clientId, oidcRedirectUri: redirectUri } = getConfig();

    const verifier = generateRandomBase64Url(64);
    const challenge = await generateCodeChallenge(verifier);
    const state = generateRandomBase64Url(16);

    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oauth_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    // In authentik 2026.x the authorize endpoint is global (no slug in path).
    window.location.href = `${baseUrl}/application/o/authorize/?${params.toString()}`;
  };

  const logout = () => {
    sessionStorage.clear();
    setToken(null);
    setUserUuid(null);
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ token, userUuid, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
