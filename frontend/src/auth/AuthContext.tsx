import React, { createContext, useEffect, useState } from 'react';

interface AuthContextValue {
  token: string | null;
  userUuid: string | null;
  login: () => void;
  logout: () => void;
}

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

  // If a new token arrives in sessionStorage from OAuthCallback, pick it up.
  useEffect(() => {
    const storedToken = sessionStorage.getItem('auth_token');
    const storedUuid = sessionStorage.getItem('user_uuid');
    if (storedToken !== token) setToken(storedToken);
    if (storedUuid !== userUuid) setUserUuid(storedUuid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async () => {
    const baseUrl = import.meta.env.VITE_AUTHENTIK_BASE_URL as string;
    const clientId = import.meta.env.VITE_OIDC_CLIENT_ID as string;
    const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI as string;
    const slug = import.meta.env.VITE_OIDC_SLUG as string;

    const verifier = generateRandomBase64Url(64);
    const challenge = await generateCodeChallenge(verifier);
    const state = generateRandomBase64Url(16);

    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oauth_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    window.location.href = `${baseUrl}/application/o/${slug}/authorize/?${params.toString()}`;
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
