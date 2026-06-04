import { useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchAll, getSearchLinkGen } from '../api/search';
import type { UserSearchResult, GroupSearchResult, SearchResult } from '../api/search';
import { useDebounce } from '../hooks/useDebounce';

interface SearchBarProps {
  onNavigate: (url: string) => void;
}

// Local component — no need to export.
function SearchCategoryHeader({ label }: { label: string }) {
  return (
    <li className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
      {label}
    </li>
  );
}

export default function SearchBar({ onNavigate }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const { data: searchData } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchAll(debouncedQuery),
    enabled: debouncedQuery.trim().length > 1,
    staleTime: 10_000,
  });

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

  const userResults: UserSearchResult[] = (searchData ?? []).filter(
    (r): r is UserSearchResult => r.__search_type === 'user',
  );
  const groupResults: GroupSearchResult[] = (searchData ?? []).filter(
    (r): r is GroupSearchResult => r.__search_type === 'group',
  );

  const flatResults: (UserSearchResult | GroupSearchResult)[] = [
    ...userResults,
    ...groupResults,
  ];

  const hasResults = userResults.length > 0 || groupResults.length > 0;

  const handleSelect = (result: UserSearchResult | GroupSearchResult) => {
    let url: string;
    if (generateLink) {
      url = generateLink(result);
    } else {
      switch (result.__search_type) {
        case 'user':
          url = `/users/${encodeURIComponent(result.username)}`;
          break;
        case 'group':
          url = `/groups/${encodeURIComponent(result.name)}`;
          break;
      }
    }
    setQuery(''); setOpen(false); onNavigate(url);
  };

  return (
    <div className="relative flex-1 max-w-xl">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setSelectedIndex(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !hasResults) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, -1));
          } else if (e.key === 'Enter') {
            if (selectedIndex >= 0) {
              e.preventDefault();
              handleSelect(flatResults[selectedIndex]);
            } else if (flatResults.length === 1) {
              e.preventDefault();
              handleSelect(flatResults[0]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
            setSelectedIndex(-1);
          }
        }}
        placeholder="Search users and groups…"
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm
                   focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {open && query.trim() && hasResults && (
        <ul className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border
                       border-gray-200 bg-white shadow-lg max-h-72 overflow-y-auto">
          {userResults.length > 0 && (
            <>
              <SearchCategoryHeader label="Users" />
              {userResults.map((u) => (
                <li
                  key={u.uuid}
                  onMouseDown={() => handleSelect(u)}
                  className={`px-3 py-2 text-sm text-gray-700 cursor-pointer ${
                    userResults.indexOf(u) === selectedIndex ? 'bg-indigo-50' : 'hover:bg-indigo-50'
                  }`}
                >
                  {u.name}{' '}
                  <span className="text-gray-400 text-xs">(@{u.username})</span>
                </li>
              ))}
            </>
          )}
          {groupResults.length > 0 && (
            <>
              <SearchCategoryHeader label="Groups" />
              {groupResults.map((g) => (
                <li
                  key={g.pk}
                  onMouseDown={() => handleSelect(g)}
                  className={`px-3 py-2 text-sm text-gray-700 cursor-pointer ${
                    userResults.length + groupResults.indexOf(g) === selectedIndex
                      ? 'bg-indigo-50'
                      : 'hover:bg-indigo-50'
                  }`}
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
