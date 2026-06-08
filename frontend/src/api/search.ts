import apiClient from './client';

export interface UserSearchResult {
  __search_type: 'user';
  username: string;
  name: string;
}

export interface GroupSearchResult {
  __search_type: 'group';
  name: string;
}

export type SearchResult = UserSearchResult | GroupSearchResult;

export async function searchAll(q: string, types?: ('user' | 'group')[]): Promise<SearchResult[]> {
  const params: Record<string, string> = { q };
  if (types && types.length > 0) params.types = types.join(',');
  const { data } = await apiClient.get<SearchResult[]>('/api/search', { params });
  return data;
}

export async function getSearchLinkGen(): Promise<string> {
  const { data } = await apiClient.get<string>('/api/search-link-gen');
  return data;
}
