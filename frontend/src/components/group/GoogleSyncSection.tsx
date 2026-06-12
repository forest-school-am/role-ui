import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setGoogleSync } from '../../api/groups';
import { invalidateGroup } from '../../api/groupQueryHelpers';
import { extractApiError } from '../../api/client';
import Section from '../ui/Section';
import EmptyNote from '../ui/EmptyNote';
import Contact from '../ui/Contact';

const GWS_DOMAIN = 'gws.forest-school.am';
const NAME_RE = /^[a-z0-9.]+$/;

const SyncIcon = () => (
  <svg className="h-3 w-3 text-gray-400" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
  </svg>
);

interface GoogleSyncSectionProps {
  groupName: string;
  googleSync: { recursive_name?: string | null; direct_name?: string | null } | null | undefined;
  canEdit: boolean;
  className?: string;
}

const GoogleSyncSection: React.FC<GoogleSyncSectionProps> = ({
  groupName,
  googleSync,
  canEdit,
  className,
}) => {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [recursive, setRecursive] = useState('');
  const [direct, setDirect] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      setGoogleSync(
        groupName,
        recursive || undefined,
        direct || undefined,
      ),
    onSuccess: () => {
      setEditing(false);
      setValidationError(null);
      invalidateGroup(queryClient, groupName);
    },
    onError: (err) => setValidationError(extractApiError(err)),
  });

  function startEdit() {
    setRecursive(googleSync?.recursive_name ?? '');
    setDirect(googleSync?.direct_name ?? '');
    setValidationError(null);
    setEditing(true);
  }

  function save() {
    if (recursive && !NAME_RE.test(recursive)) {
      setValidationError('Recursive name must match [a-z0-9.]+');
      return;
    }
    if (direct && !NAME_RE.test(direct)) {
      setValidationError('Direct name must match [a-z0-9.]+');
      return;
    }
    setValidationError(null);
    mutation.mutate();
  }

  const hasData = googleSync?.recursive_name || googleSync?.direct_name;

  return (
    <Section
      title="Google Sync"
      icon={<SyncIcon />}
      onEdit={canEdit && !editing ? startEdit : undefined}
      className={className}
    >
      {editing ? (
        <div className="space-y-2">
          <label className="block text-xs text-gray-500">
            Recursive
            <input
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
              value={recursive}
              onChange={(e) => setRecursive(e.target.value)}
              placeholder="e.g. all.members"
              autoFocus
            />
          </label>
          <label className="block text-xs text-gray-500">
            Direct
            <input
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
              value={direct}
              onChange={(e) => setDirect(e.target.value)}
              placeholder="e.g. direct.members"
            />
          </label>
          {validationError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              {validationError}
            </p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={mutation.isPending}
              className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={mutation.isPending}
              className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : hasData ? (
        <div className="space-y-1">
          {googleSync?.recursive_name && (
            <SyncEntry label="Recursive" name={googleSync.recursive_name} />
          )}
          {googleSync?.direct_name && (
            <SyncEntry label="Direct" name={googleSync.direct_name} />
          )}
        </div>
      ) : (
        <EmptyNote>Not configured</EmptyNote>
      )}
    </Section>
  );
};

function SyncEntry({ label, name }: { label: string; name: string }) {
  const full = `${name}@${GWS_DOMAIN}`;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-gray-400 w-14 shrink-0">{label}</span>
      <span className="font-mono text-gray-700">
        <Contact value={full} />
      </span>
    </div>
  );
}

export default GoogleSyncSection;
