import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, GroupRole } from '../types';
import GroupTag from './GroupTag';

interface UserCardProps {
  user: User;
}

const LOGIN_LABELS: Record<string, string> = {
  email: 'Email',
  telegram: 'Telegram',
  google: 'Google',
};

function loginLabel(kind: string): string {
  return LOGIN_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

function loginHref(kind: string, address: string): string | undefined {
  if (kind === 'email') return `mailto:${address}`;
  if (kind === 'telegram') return `https://t.me/${address.replace(/^@/, '')}`;
  return undefined;
}

interface FlatGroupMembership {
  name: string;
  role: GroupRole;
}

function flattenGroups(user: User): FlatGroupMembership[] {
  const groups: FlatGroupMembership[] = [];
  for (const g of user.groups.leader) groups.push({ name: g.name, role: 'leader' });
  for (const g of user.groups.manager) groups.push({ name: g.name, role: 'manager' });
  for (const g of user.groups.member) groups.push({ name: g.name, role: 'member' });
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

const UserCard: React.FC<UserCardProps> = ({ user }) => {
  const navigate = useNavigate();
  const sortedGroups = flattenGroups(user);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 max-w-xl w-full mx-auto">
      {/* Header */}
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
          <dt className="font-medium text-gray-500 w-24 shrink-0">Username</dt>
          <dd className="font-mono text-gray-600">{user.username}</dd>
        </div>

        {user.logins.map((account) => {
          const href = loginHref(account.kind, account.address);
          return (
            <div key={account.kind} className="flex gap-2">
              <dt className="font-medium text-gray-500 w-24 shrink-0">
                {loginLabel(account.kind)}
              </dt>
              <dd>
                {href ? (
                  <a href={href} className="text-blue-600 hover:underline">
                    {account.address}
                  </a>
                ) : (
                  account.address
                )}
              </dd>
            </div>
          );
        })}
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
                key={gm.name}
                groupName={gm.name}
                role={gm.role}
                onClick={() => navigate(`/groups/${encodeURIComponent(gm.name)}`)}
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
