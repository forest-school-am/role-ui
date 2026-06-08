import apiClient from './client';
import type { User, UserLink } from '../types';

export async function getMe(): Promise<User> {
  const response = await apiClient.get<User>('/api/users/me');
  return response.data;
}

export async function getUser(username: string): Promise<User> {
  const { data } = await apiClient.get<User>(`/api/users/${encodeURIComponent(username)}`);
  return data;
}

export async function searchUsers(term: string): Promise<UserLink[]> {
  const { data } = await apiClient.get<UserLink[]>('/api/users', {
    params: { search: term },
  });
  return data;
}
