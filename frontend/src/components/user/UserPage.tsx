import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { User, GroupRole } from '../../types';
import GroupTag from '../group/GroupTag';
import CopyIcon from '../ui/CopyIcon';
import Section from '../ui/Section';
import EditButton from '../ui/EditButton';
import NameFreezeToggle from './NameFreezeToggle';
import { patchMyAttributes, setDisplayName } from '../../api/users';
import { extractApiError } from '../../api/client';
import { useSuperuser } from '../../auth/SuperuserContext';

interface UserPageProps {
  user: User;
  isMe?: boolean;
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

const UserPage: React.FC<UserPageProps> = ({ user, isMe }) => {
  const navigate = useNavigate();
  const sortedGroups = flattenGroups(user);
  const { superuserModeActive } = useSuperuser();

  const queryClient = useQueryClient();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  function invalidateUser() {
    void queryClient.refetchQueries({ queryKey: ['user', user.username] });
    void queryClient.refetchQueries({ queryKey: ['me'] });
  }

  const renameMutation = useMutation({
    mutationFn: (name: string) => setDisplayName(name),
    onSuccess: () => {
      setIsEditingName(false);
      setNameError(null);
      invalidateUser();
    },
    onError: (err) => setNameError(extractApiError(err)),
  });

  function startEditingName() {
    setNameValue(user.name);
    setNameError(null);
    setIsEditingName(true);
  }

  const canEditName = isMe && (!user.name_frozen || superuserModeActive);

  const [isEditingAttrs, setIsEditingAttrs] = useState(false);
  const [editedAttrs, setEditedAttrs] = useState<[string, string][]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (edited: [string, string][]) => {
      const attributes = Object.fromEntries(edited.filter(([k]) => k.trim() !== ''));
      return patchMyAttributes(attributes);
    },
    onSuccess: () => {
      setSaveError(null);
      setIsEditingAttrs(false);
      invalidateUser();
    },
    onError: (err) => setSaveError(extractApiError(err)),
  });

  function startEditing() {
    setEditedAttrs(user.attributes.map(([k, v]) => [k, v] as [string, string]));
    setSaveError(null);
    setIsEditingAttrs(true);
  }

  function cancelEditing() {
    setIsEditingAttrs(false);
    setEditedAttrs([]);
    setSaveError(null);
  }

  function updateAttr(i: number, key: string, value: string) {
    setEditedAttrs((prev) => prev.map((pair, idx) => (idx === i ? [key, value] : pair)));
  }

  function removeAttr(i: number) {
    setEditedAttrs((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addAttr() {
    setEditedAttrs((prev) => [...prev, ['', '']]);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 max-w-xl w-full mx-auto">
      {/* Header */}
      <div className="mb-4">
        {isEditingName ? (
          <div className="space-y-1">
            <input
              className="w-full rounded border border-gray-300 px-2 py-1 text-xl font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameMutation.mutate(nameValue);
                if (e.key === 'Escape') setIsEditingName(false);
              }}
            />
            {nameError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                {nameError}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-0.5">
              <button
                type="button"
                onClick={() => setIsEditingName(false)}
                disabled={renameMutation.isPending}
                className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => renameMutation.mutate(nameValue)}
                disabled={renameMutation.isPending}
                className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {renameMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-gray-900">{user.name}</h1>
            <span
              className={`self-center rounded-full px-2 py-0.5 text-xs font-medium ${
                user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {user.is_active ? 'Active' : 'Suspended'}
            </span>
            {canEditName && (
              <EditButton onClick={startEditingName} className="self-center" />
            )}
            {superuserModeActive && (
              <NameFreezeToggle username={user.username} frozen={user.name_frozen} className="self-center" />
            )}
          </div>
        )}
      </div>

      {/* Login details */}
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
              <dd className="flex items-center gap-1.5">
                {href ? (
                  <a href={href} className="text-blue-600 hover:underline">
                    {account.address}
                  </a>
                ) : (
                  <span>{account.address}</span>
                )}
                <CopyIcon text={account.address} />
              </dd>
            </div>
          );
        })}
      </dl>

      {/* Group memberships */}
      {sortedGroups.length > 0 ? (
        <Section title="Groups" className="mb-6">
          <div className="flex flex-wrap gap-2 mt-2">
            {sortedGroups.map((gm) => (
              <GroupTag
                key={gm.name}
                groupName={gm.name}
                role={gm.role}
                onClick={() => navigate(`/groups/${encodeURIComponent(gm.name)}`)}
              />
            ))}
          </div>
        </Section>
      ) : (
        <p className="text-sm text-gray-400 italic mb-6">No group memberships.</p>
      )}

      {/* Attributes */}
      <Section
        title="Attributes"
        className="pt-6 border-t border-gray-100"
        onEdit={isMe && !isEditingAttrs ? startEditing : undefined}
      >
        {isEditingAttrs ? (
          <div className="mt-2">
            <table className="w-full border-collapse text-sm mb-3">
              <tbody>
                {editedAttrs.map(([k, v], i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2 w-5/12">
                      <input
                        className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        value={k}
                        onChange={(e) => updateAttr(i, e.target.value, v)}
                        placeholder="key"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        value={v}
                        onChange={(e) => updateAttr(i, k, e.target.value)}
                        placeholder="value"
                      />
                    </td>
                    <td className="py-1 w-6 text-center">
                      <button
                        type="button"
                        onClick={() => removeAttr(i)}
                        className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button
              type="button"
              onClick={addAttr}
              className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors mb-4"
            >
              + Add attribute
            </button>

            {saveError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
                {saveError}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saveMutation.isPending}
                className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveMutation.mutate(editedAttrs)}
                disabled={saveMutation.isPending}
                className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : user.attributes.length === 0 ? (
          <p className="text-sm text-gray-400 italic mt-1">No attributes.</p>
        ) : (
          <table className="w-full border-collapse text-sm mt-2">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-1.5 text-xs text-gray-400 font-medium w-5/12">
                  Key
                </th>
                <th className="text-left pb-1.5 text-xs text-gray-400 font-medium">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {user.attributes.map(([k, v], i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-gray-600 break-all">{k}</span>
                      <CopyIcon text={k} />
                    </div>
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-700 break-all">{v}</span>
                      <CopyIcon text={v} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
};

export default UserPage;
