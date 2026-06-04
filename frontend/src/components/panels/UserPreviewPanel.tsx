import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getUser } from '../../api/users';

interface UserPreviewPanelProps {
  username: string;
  onClose: () => void;
}

const UserPreviewPanel: React.FC<UserPreviewPanelProps> = ({ username, onClose }) => {
  const { data: user, isLoading, isError, error } = useQuery({
    queryKey: ['user', username],
    queryFn: () => getUser(username),
  });

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed right-0 top-0 h-full w-72 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-none">
        {user ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">{user.name}</h2>
            <Link
              to={`/users/${username}`}
              className="flex-none text-gray-400 hover:text-indigo-600 transition-colors"
              title="Open profile page"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </Link>
          </div>
        ) : (
          <h2 className="text-sm font-semibold text-gray-900 truncate">{username}</h2>
        )}
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-2 flex-none"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-6 rounded bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <p className="text-red-500 text-sm">
            {error instanceof Error ? error.message : 'Failed to load user.'}
          </p>
        )}

        {user && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">@{user.username}</p>

            {user.social.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                  Social
                </p>
                <div className="space-y-1">
                  {user.social.slice(0, 3).map((s, i) => (
                    <p key={i} className="text-sm text-gray-700">
                      <span className="font-medium">{s.type}:</span> {s.address}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>


    </div>
  );
};

export default UserPreviewPanel;
