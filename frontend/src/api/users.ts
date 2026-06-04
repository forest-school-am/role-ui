import apiClient from './client';
import type { User } from '../types';

export async function getMe(): Promise<User> {
  const response = await apiClient.get<User>('/api/users/me');
  return response.data;
}

export async function getUser(username: string): Promise<User> {
  const { data } = await apiClient.get<User>(`/api/users/${encodeURIComponent(username)}`);
  return data;
}

export interface UserSummary {
  pk: number;
  uuid: string;
  username: string;
  name: string;
  social: Array<{ type: string; address: string }>;
}

export async function searchUsers(term: string): Promise<UserSummary[]> {
  const { data } = await apiClient.get<UserSummary[]>('/api/users', {
    params: { search: term },
  });
  return data;
}
