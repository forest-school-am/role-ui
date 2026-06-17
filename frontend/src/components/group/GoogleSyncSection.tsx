import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setGoogleSync } from '../../api/groups';
import { invalidateGroup } from '../../api/groupQueryHelpers';
import { extractApiError } from '../../api/client';
import Section from '../ui/Section';
import EmptyNote from '../ui/EmptyNote';
import Contact from '../ui/Contact';
import EditButton from '../ui/EditButton';

const GWS_DOMAIN = 'gws.forest-school.am';
const EMAIL_RE = /^[a-z0-9.-]+$/;

const SyncIcon = () => (
  <svg className="h-3 w-3 text-gray-400" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
  </svg>
);

interface SyncEntryData { name?: string; email?: string; description: string }

interface GoogleSyncSectionProps {
  groupName: string;
  googleSync: { recursive?: SyncEntryData | null; direct?: SyncEntryData | null } | null | undefined;
  canEdit: boolean;
  className?: string;
}

const GoogleSyncSection: React.FC<GoogleSyncSectionProps> = ({
  groupName,
  googleSync,
  canEdit,
  className,
}) => {
  const hasData = googleSync?.recursive || googleSync?.direct;

  return (
    <Section title="Google Sync" icon={<SyncIcon />} className={className}>
      {hasData ? (
        <div className="space-y-3">
          {googleSync?.recursive && (
            <SyncEntryRow
              label="Recursive"
              entry={googleSync.recursive}
              groupName={groupName}
              entryKind="recursive"
              canEdit={canEdit}
            />
          )}
          {googleSync?.direct && (
            <SyncEntryRow
              label="Direct"
              entry={googleSync.direct}
              groupName={groupName}
              entryKind="direct"
              canEdit={canEdit}
            />
          )}
        </div>
      ) : (
        <EmptyNote>Not configured</EmptyNote>
      )}
    </Section>
  );
};

function SyncEntryRow({
  label,
  entry,
  groupName,
  entryKind,
  canEdit,
}: {
  label: string;
  entry: SyncEntryData;
  groupName: string;
  entryKind: 'recursive' | 'direct';
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      setGoogleSync(groupName, {
        [entryKind]: {
          name: name || undefined,
          email: email || undefined,
          description: description || undefined,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      setValidationError(null);
      invalidateGroup(queryClient, groupName);
    },
    onError: (err) => setValidationError(extractApiError(err)),
  });

  function startEdit() {
    setName(entry.name ?? '');
    setEmail(entry.email ?? '');
    setDescription(entry.description);
    setValidationError(null);
    setEditing(true);
  }

  function save() {
    if (email && !EMAIL_RE.test(email)) {
      setValidationError('Email must match [a-z0-9.-]+');
      return;
    }
    setValidationError(null);
    mutation.mutate();
  }

  const full = entry.email ? `${entry.email}@${GWS_DOMAIN}` : undefined;

  if (editing) {
    return (
      <div className="space-y-1.5 text-xs">
        <span className="font-medium text-gray-500">{label}</span>
        <input
          className="w-full rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          autoFocus
        />
        <input
          className="w-full rounded border border-gray-200 px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`Email local part (e.g. ${entryKind}.group)`}
        />
        <input
          className="w-full rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
        />
        {validationError && (
          <p className="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {validationError}
          </p>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={mutation.isPending}
            className="px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={mutation.isPending}
            className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-gray-400">{label}</span>
        {canEdit && <EditButton onClick={startEdit} />}
      </div>
      {entry.name && <div className="text-gray-700">{entry.name}</div>}
      {full && <div className="font-mono text-gray-500"><Contact value={full} /></div>}
      {entry.description && <div className="text-gray-400 italic">{entry.description}</div>}
    </div>
  );
}

export default GoogleSyncSection;
