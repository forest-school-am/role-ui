import type { AxiosRequestConfig } from 'axios';
import apiClient from './client';

// Custom orval mutator: delegates to the authenticated apiClient and unwraps .data
export const customMutator = <T>(config: AxiosRequestConfig): Promise<T> => {
  return apiClient({ ...config, url: `/api${config.url}` }).then((res) => res.data as T);
};
