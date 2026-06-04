import apiClient from './client';
import type { User } from '../types';

export async function getMe(): Promise<User> {
  const response = await apiClient.get<User>('/api/users/me');
  return response.data;
}

export async function getUser(uuid: string): Promise<User> {
  const response = await apiClient.get<User>(`/api/users/${uuid}`);
  return response.data;
}
