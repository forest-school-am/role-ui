import React from 'react';
import type { User } from '../types';
import GroupTag from './GroupTag';

interface UserCardProps {
  user: User;
}

const UserCard: React.FC<UserCardProps> = ({ user }) => {
  const sortedGroups = [...user.groups].sort((a, b) =>
    a.group_name.localeCompare(b.group_name),
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 max-w-xl w-full mx-auto">
      {/* Header: name + status badge */}
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">{user.name}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            user.is_active
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {user.is_active ? 'Active' : 'Suspended'}
        </span>
      </div>

      {/* Details */}
      <dl className="space-y-2 text-sm text-gray-700 mb-6">
        <div className="flex gap-2">
          <dt className="font-medium text-gray-500 w-24 shrink-0">Email</dt>
          <dd>
            <a
              href={`mailto:${user.email}`}
              className="text-blue-600 hover:underline"
            >
              {user.email}
            </a>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-gray-500 w-24 shrink-0">Telegram</dt>
          <dd>{user.telegram ?? '–'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-gray-500 w-24 shrink-0">Username</dt>
          <dd className="font-mono text-gray-600">{user.username}</dd>
        </div>
      </dl>

      {/* Group memberships */}
      {sortedGroups.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Groups
          </p>
          <div className="flex flex-wrap gap-2">
            {sortedGroups.map((gm) => (
              <GroupTag
                key={gm.group_pk}
                groupName={gm.group_name}
                role={gm.role}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No group memberships.</p>
      )}
    </div>
  );
};

export default UserCard;
