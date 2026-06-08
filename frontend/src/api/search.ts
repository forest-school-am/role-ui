import { searchAll as _searchAll, getSearchLinkGen } from './generated';

export { getSearchLinkGen };
export type { SearchResult } from './generated';
export type { SearchResultUser as UserSearchResult, SearchResultGroup as GroupSearchResult } from './generated';

export const searchAll = (q: string, types?: ('user' | 'group')[]) => {
  const params: { q: string; types?: string } = { q };
  if (types && types.length > 0) params.types = types.join(',');
  return _searchAll(params);
};
