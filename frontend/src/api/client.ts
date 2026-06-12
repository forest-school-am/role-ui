import axios from 'axios';
import { refreshAccessToken } from '../auth/tokenRefresh';

const apiClient = axios.create({
  baseURL: '',
});

// Request interceptor: inject Bearer token and superuser mode header from sessionStorage
apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (sessionStorage.getItem('superuser_mode') === 'true') {
    config.headers['x-as-superuser'] = 'true';
  }
  return config;
});

// Response interceptor: on 401 attempt a silent token refresh then retry once.
// Only clear session and redirect if the refresh itself fails.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const originalConfig = error.config;
      // Avoid infinite retry loops (e.g. if the retry itself 401s).
      if (originalConfig && !(originalConfig as { _retried?: boolean })._retried) {
        (originalConfig as { _retried?: boolean })._retried = true;
        try {
          const newToken = await refreshAccessToken();
          originalConfig.headers = originalConfig.headers ?? {};
          originalConfig.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalConfig);
        } catch {
          console.error('[auth] refresh failed after 401, clearing session');
          sessionStorage.clear();
          window.location.href = '/';
        }
      } else {
        console.error('[auth] 401 on retry, clearing session');
        sessionStorage.clear();
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  },
);

export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.data?.error) {
    return err.response.data.error as string;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

export default apiClient;
