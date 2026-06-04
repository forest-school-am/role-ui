import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchAll, getSearchLinkGen } from '../api/search';
import type { UserSearchResult, GroupSearchResult, SearchResult } from '../api/search';

interface SearchBarProps {
  onNavigate: (url: string) => void;
}

export default function SearchBar({ onNavigate }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: linkGenJs } = useQuery({
    queryKey: ['search-link-gen'],
    queryFn: getSearchLinkGen,
    staleTime: Infinity,
  });

  const generateLink = useMemo<((obj: SearchResult) => string) | null>(() => {
    if (!linkGenJs) return null;
    try {
      // eslint-disable-next-line no-new-func
      return new Function('obj', `${linkGenJs}; return generateSearchLink(obj);`) as (obj: SearchResult) => string;
    } catch {
      return null;
    }
  }, [linkGenJs]);

  const { data: searchData } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchAll(debouncedQuery),
    enabled: debouncedQuery.trim().length > 1,
    staleTime: 10_000,
  });

  const userResults: UserSearchResult[] = (searchData ?? []).filter(
    (r): r is UserSearchResult => r.__search_type === 'user',
  );
  const groupResults: GroupSearchResult[] = (searchData ?? []).filter(
    (r): r is GroupSearchResult => r.__search_type === 'group',
  );

  const hasResults = userResults.length > 0 || groupResults.length > 0;

  const handleSelect = (result: UserSearchResult | GroupSearchResult) => {
    const url = generateLink ? generateLink(result) : '#';
    setQuery(''); setOpen(false); onNavigate(url);
  };

  return (
    <div className="relative flex-1 max-w-xl">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search users and groups…"
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm
                   focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {open && query.trim() && hasResults && (
        <ul className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border
                       border-gray-200 bg-white shadow-lg max-h-72 overflow-y-auto">
          {userResults.length > 0 && (
            <>
              <li className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                Users
              </li>
              {userResults.map((u) => (
                <li
                  key={u.uuid}
                  onMouseDown={() => handleSelect(u)}
                  className="px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 cursor-pointer"
                >
                  {u.name}{' '}
                  <span className="text-gray-400 text-xs">(@{u.username})</span>
                </li>
              ))}
            </>
          )}
          {groupResults.length > 0 && (
            <>
              <li className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100 border-t border-gray-100">
                Groups
              </li>
              {groupResults.map((g) => (
                <li
                  key={g.pk}
                  onMouseDown={() => handleSelect(g)}
                  className="px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 cursor-pointer"
                >
                  {g.name}
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
