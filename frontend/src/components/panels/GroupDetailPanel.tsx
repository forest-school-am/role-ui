import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getGroup, addMember, removeMember, addManager, removeManager, assignLeader, createSubgroup } from '../../api/groups';
import type { GroupRole, GroupMember } from '../../types';
import CrownIcon from '../CrownIcon';
import { useNavigate } from 'react-router-dom';

interface GroupDetailPanelProps {
  groupPk: string;
  callerRole: GroupRole | 'non-member';
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Add Member Modal
// ---------------------------------------------------------------------------
interface AddMemberModalProps {
  groupPk: string;
  onClose: () => void;
}

const AddMemberModal: React.FC<AddMemberModalProps> = ({ groupPk, onClose }) => {
  const [userPkInput, setUserPkInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (userPk: number) => addMember(groupPk, userPk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group', groupPk] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to add member.';
      setLocalError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const pk = parseInt(userPkInput.trim(), 10);
    if (isNaN(pk) || pk <= 0) {
      setLocalError('Please enter a valid numeric User PK.');
      return;
    }
    mutation.mutate(pk);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Add Member</h3>
        <p className="text-xs text-gray-500 mb-3">
          Enter the user's integer PK. Find user PKs on their profile page.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="userPkInput">
              User PK
            </label>
            <input
              id="userPkInput"
              type="number"
              min="1"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={userPkInput}
              onChange={(e) => setUserPkInput(e.target.value)}
              placeholder="e.g. 42"
              autoFocus
            />
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Create Subgroup Modal
// ---------------------------------------------------------------------------
interface CreateSubgroupModalProps {
  groupPk: string;
  onClose: () => void;
}

const CreateSubgroupModal: React.FC<CreateSubgroupModalProps> = ({ groupPk, onClose }) => {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (subgroupName: string) => createSubgroup(groupPk, subgroupName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to create subgroup.';
      setLocalError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Subgroup name is required.');
      return;
    }
    if (trimmed.length > 150) {
      setLocalError('Name must be 150 characters or fewer.');
      return;
    }
    mutation.mutate(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Create Subgroup</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="subgroupName">
              Subgroup Name
            </label>
            <input
              id="subgroupName"
              type="text"
              maxLength={150}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Frontend Team"
              autoFocus
            />
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// MemberRow
// ---------------------------------------------------------------------------
interface MemberRowProps {
  member: GroupMember;
  groupPk: string;
  callerRole: GroupRole | 'non-member';
  isLeader?: boolean;
  isManager?: boolean;
}

const MemberRow: React.FC<MemberRowProps> = ({
  member,
  groupPk,
  callerRole,
  isLeader = false,
  isManager = false,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const onMutationError = (err: unknown) => {
    setMutationError(err instanceof Error ? err.message : 'Operation failed.');
  };

  const removeMemberMutation = useMutation({
    mutationFn: () => removeMember(groupPk, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group', groupPk] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: onMutationError,
  });

  const addManagerMutation = useMutation({
    mutationFn: () => addManager(groupPk, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group', groupPk] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: onMutationError,
  });

  const removeManagerMutation = useMutation({
    mutationFn: () => removeManager(groupPk, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group', groupPk] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: onMutationError,
  });

  const assignLeaderMutation = useMutation({
    mutationFn: () => assignLeader(groupPk, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group', groupPk] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: onMutationError,
  });

  const handleRemoveMember = () => {
    if (window.confirm(`Remove ${member.name} from this group?`)) {
      setMutationError(null);
      removeMemberMutation.mutate();
    }
  };

  const handleAssignLeader = () => {
    if (window.confirm(`Assign ${member.name} as the new leader? You will become a regular member.`)) {
      setMutationError(null);
      assignLeaderMutation.mutate();
    }
  };

  const isBusy =
    removeMemberMutation.isPending ||
    addManagerMutation.isPending ||
    removeManagerMutation.isPending ||
    assignLeaderMutation.isPending;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded group">
        {isLeader && <CrownIcon variant="gold" size="sm" />}
        {isManager && !isLeader && <CrownIcon variant="silver" size="sm" />}
        <span
          className="text-sm text-gray-800 cursor-pointer hover:underline flex-1 min-w-0 truncate"
          onClick={() => navigate(`/users/${member.uuid}`)}
        >
          {member.name}
        </span>
        <span className="text-xs text-gray-400 hidden sm:inline truncate max-w-[100px]">{member.email}</span>

        {/* Action buttons — shown on hover, hidden when busy */}
        <div className={`flex gap-1 ${isBusy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
          {/* Manager or leader: remove regular member */}
          {(callerRole === 'manager' || callerRole === 'leader') &&
            !isLeader &&
            !isManager && (
              <button
                className="text-xs text-red-500 hover:text-red-700 px-1 disabled:opacity-50"
                onClick={handleRemoveMember}
                disabled={isBusy}
              >
                {removeMemberMutation.isPending ? '…' : 'Remove'}
              </button>
            )}

          {/* Leader only: promote regular member to manager */}
          {callerRole === 'leader' && !isLeader && !isManager && (
            <button
              className="text-xs text-indigo-500 hover:text-indigo-700 px-1 disabled:opacity-50"
              onClick={() => { setMutationError(null); addManagerMutation.mutate(); }}
              disabled={isBusy}
            >
              {addManagerMutation.isPending ? '…' : 'Make manager'}
            </button>
          )}

          {/* Leader only: demote manager back to member */}
          {callerRole === 'leader' && isManager && (
            <>
              <button
                className="text-xs text-red-500 hover:text-red-700 px-1 disabled:opacity-50"
                onClick={() => { setMutationError(null); removeManagerMutation.mutate(); }}
                disabled={isBusy}
              >
                {removeManagerMutation.isPending ? '…' : 'Remove manager'}
              </button>
              <button
                className="text-xs text-yellow-600 hover:text-yellow-800 px-1 disabled:opacity-50"
                onClick={handleAssignLeader}
                disabled={isBusy}
              >
                {assignLeaderMutation.isPending ? '…' : 'Make leader'}
              </button>
            </>
          )}
        </div>
      </div>
      {mutationError && (
        <p
          className="text-xs text-red-500 px-2 pb-1 cursor-pointer"
          onClick={() => setMutationError(null)}
          title="Click to dismiss"
        >
          {mutationError}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GroupDetailPanel
// ---------------------------------------------------------------------------
const GroupDetailPanel: React.FC<GroupDetailPanelProps> = ({
  groupPk,
  callerRole,
  onClose,
}) => {
  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateSubgroup, setShowCreateSubgroup] = useState(false);

  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['group', groupPk],
    queryFn: () => getGroup(groupPk),
  });

  return (
    <>
      {showAddMember && (
        <AddMemberModal groupPk={groupPk} onClose={() => setShowAddMember(false)} />
      )}
      {showCreateSubgroup && (
        <CreateSubgroupModal groupPk={groupPk} onClose={() => setShowCreateSubgroup(false)} />
      )}

      <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 flex flex-col z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {detail?.name ?? 'Group Detail'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
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
                <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
              ))}
            </div>
          )}

          {isError && (
            <p className="text-red-500 text-sm">Failed to load group details.</p>
          )}

          {detail && (
            <>
              {/* Leader */}
              {detail.leader && (
                <section className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Leader
                  </p>
                  <MemberRow
                    member={detail.leader}
                    groupPk={groupPk}
                    callerRole={callerRole}
                    isLeader
                  />
                </section>
              )}

              {/* Managers */}
              {detail.managers.length > 0 && (
                <section className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Managers
                  </p>
                  {detail.managers.map((m) => (
                    <MemberRow
                      key={m.uuid}
                      member={m}
                      groupPk={groupPk}
                      callerRole={callerRole}
                      isManager
                    />
                  ))}
                </section>
              )}

              {/* Members */}
              <section className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Members
                  </p>
                  {(callerRole === 'manager' || callerRole === 'leader') && (
                    <button
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      onClick={() => setShowAddMember(true)}
                    >
                      + Add member
                    </button>
                  )}
                </div>
                {detail.members.length > 0 ? (
                  detail.members.map((m) => (
                    <MemberRow
                      key={m.uuid}
                      member={m}
                      groupPk={groupPk}
                      callerRole={callerRole}
                    />
                  ))
                ) : (
                  <p className="text-xs text-gray-400 italic">No regular members.</p>
                )}
              </section>

              {/* Create subgroup (leader only) */}
              {callerRole === 'leader' && (
                <section>
                  <button
                    className="w-full rounded border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
                    onClick={() => setShowCreateSubgroup(true)}
                  >
                    + Create subgroup
                  </button>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default GroupDetailPanel;
