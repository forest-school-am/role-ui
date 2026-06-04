import React from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import OAuthCallback from './auth/OAuthCallback';
import PersonalPage from './pages/PersonalPage';
import StructurePage from './pages/StructurePage';
import GroupPage from './pages/GroupPage';
import AppShell from './layouts/AppShell';

// ---------------------------------------------------------------------------
// Triggers login redirect when no token is present
// ---------------------------------------------------------------------------
const LoginRedirect: React.FC = () => {
  const { login } = useAuth();
  React.useEffect(() => {
    login();
  }, [login]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500 text-sm">Redirecting to login…</p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Route guard: redirects to login if no token in sessionStorage
// ---------------------------------------------------------------------------
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const token = sessionStorage.getItem('auth_token');
  if (!token) {
    return <LoginRedirect />;
  }
  return <>{children}</>;
};

// ---------------------------------------------------------------------------
// Root app
// ---------------------------------------------------------------------------
const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public route — OIDC callback */}
          <Route path="/callback" element={<OAuthCallback />} />

          {/* Protected routes — wrapped in AppShell layout */}
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/me" element={<PersonalPage />} />
            <Route path="/users/:username" element={<PersonalPage />} />
            <Route path="/structure" element={<StructurePage />} />
            <Route path="/groups/:name" element={<GroupPage />} />
          </Route>

          {/* Default: redirect to /me (will trigger login if no token) */}
          <Route path="/" element={<Navigate to="/me" replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/me" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
