import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../types';
import GroupTag from './GroupTag';

interface UserCardProps {
  user: User;
}

const SOCIAL_LABELS: Record<string, string> = {
  email: 'Email',
  telegram: 'Telegram',
  google: 'Google',
};

function socialLabel(type: string): string {
  return SOCIAL_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function socialHref(type: string, address: string): string | undefined {
  if (type === 'email') return `mailto:${address}`;
  if (type === 'telegram') return `https://t.me/${address.replace(/^@/, '')}`;
  return undefined;
}

const UserCard: React.FC<UserCardProps> = ({ user }) => {
  const navigate = useNavigate();
  const sortedGroups = [...user.groups].sort((a, b) =>
    a.group_name.localeCompare(b.group_name),
  );

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

        {user.social.map((account) => {
          const href = socialHref(account.type, account.address);
          return (
            <div key={account.type} className="flex gap-2">
              <dt className="font-medium text-gray-500 w-24 shrink-0">
                {socialLabel(account.type)}
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

      {/* SSH keys */}
      {user.ssh.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            SSH Keys
          </p>
          <ul className="space-y-2">
            {user.ssh.map((k) => (
              <li key={k.label} className="rounded bg-gray-50 border border-gray-200 px-3 py-2">
                <p className="text-xs font-medium text-gray-600 mb-1">{k.label}</p>
                <p className="font-mono text-xs text-gray-500 break-all">{k.key}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                onClick={() => navigate(`/groups/${encodeURIComponent(gm.group_name)}`)}
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
