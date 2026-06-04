import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getGroup, getGroups, removeMember, removeManager } from '../api/groups';
import { extractApiError } from '../api/client';
import { getMe } from '../api/users';
import type { GroupRole } from '../types';
import CrownIcon from '../components/CrownIcon';
import ColorPicker from '../components/dag/ColorPicker';
import {
  AddMemberModal,
  CreateSubgroupModal,
  AddChildGroupModal,
  ResignLeaderModal,
  DisbandGroupModal,
} from '../components/panels/GroupDetailPanel';

const GroupPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const groupName = name ?? '';
  const navigate = useNavigate();

  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateSubgroup, setShowCreateSubgroup] = useState(false);
  const [showAddChildGroup, setShowAddChildGroup] = useState(false);
  const [showResignLeader, setShowResignLeader] = useState(false);
  const [showDisband, setShowDisband] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const {
    data: detail,
    isLoading: detailLoading,
    isError: detailError,
    error: detailErrorObj,
  } = useQuery({
    queryKey: ['group', groupName],
    queryFn: () => getGroup(groupName),
    enabled: !!groupName,
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  });

  const { data: allGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });

  const callerRole: GroupRole | 'non-member' = useMemo(() => {
    if (!detail || !me) return 'non-member';
    const membership = me.groups.find((g) => g.group_pk === detail.pk);
    return membership ? membership.role : 'non-member';
  }, [detail, me]);

  const canAssignLeader = useMemo(() => {
    if (!detail || !me) return false;
    return (me.groups.find((g) => g.group_pk === detail.pk)?.role === 'leader') === true;
  }, [detail, me]);

  const removeMemberMutation = useMutation({
    mutationFn: ({ userPk }: { userPk: number }) => removeMember(groupName, userPk),
    onSuccess: () => {
      setMutationError(null);
      void queryClient.invalidateQueries({ queryKey: ['group', groupName] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const removeManagerMutation = useMutation({
    mutationFn: ({ userPk }: { userPk: number }) => removeManager(groupName, userPk),
    onSuccess: () => {
      setMutationError(null);
      void queryClient.invalidateQueries({ queryKey: ['group', groupName] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  if (detailLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="space-y-3 w-full max-w-xl mx-auto p-8">
          <div className="h-8 rounded bg-gray-200 animate-pulse w-1/2" />
          <div className="h-4 rounded bg-gray-200 animate-pulse w-3/4" />
          <div className="h-4 rounded bg-gray-200 animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (detailError) {
    const message =
      detailErrorObj instanceof Error ? detailErrorObj.message : 'Failed to load group.';
    const isNotFound = message.toLowerCase().includes('not found');
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-1">
            {isNotFound ? 'Group not found' : 'Error'}
          </h2>
          <p className="text-sm">{message}</p>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const resolvedGroups = allGroups ?? [];

  const canManage = callerRole === 'leader' || callerRole === 'manager';

  return (
    <>
      {showAddMember && (
        <AddMemberModal
          groupPk={detail.pk}
          groupName={detail.name}
          onClose={() => setShowAddMember(false)}
        />
      )}
      {showCreateSubgroup && (
        <CreateSubgroupModal
          groupPk={detail.pk}
          groupName={detail.name}
          onClose={() => setShowCreateSubgroup(false)}
        />
      )}
      {showAddChildGroup && (
        <AddChildGroupModal
          parentGroupPk={detail.pk}
          parentGroupName={detail.name}
          onClose={() => setShowAddChildGroup(false)}
        />
      )}
      {showResignLeader && (
        <ResignLeaderModal
          groupPk={detail.pk}
          groupName={detail.name}
          members={[...(detail.managers ?? []), ...(detail.members ?? [])]}
          onClose={() => setShowResignLeader(false)}
        />
      )}
      {showDisband && detail && (
        <DisbandGroupModal
          groupPk={detail.pk}
          groupName={detail.name}
          onClose={() => setShowDisband(false)}
          onSuccess={() => navigate('/structure')}
        />
      )}

      <div className="max-w-5xl mx-auto p-8">
        {mutationError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mx-3 mb-2">{mutationError}</p>
        )}
        <div className="flex flex-col md:flex-row gap-8">
          {/* Left — identity */}
          <div className="flex-none w-full md:w-64 space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">{detail.name}</h1>

            {/* Parent groups */}
            {detail.parent_pks.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                  Parent Groups
                </p>
                <div className="space-y-1">
                  {detail.parent_pks.map((pk) => {
                    const parent = resolvedGroups.find((g) => g.pk === pk);
                    if (!parent) return null;
                    return (
                      <Link
                        key={pk}
                        to={'/groups/' + encodeURIComponent(parent.name)}
                        className="block text-sm text-indigo-600 hover:underline"
                      >
                        {parent.name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Leader */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                Leader
              </p>
              {detail.leader ? (
                <div className="flex items-center gap-1.5">
                  <CrownIcon variant="gold" size="sm" />
                  <Link
                    to={`/users/${detail.leader.username}`}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    {detail.leader.name}
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No leader</p>
              )}
            </div>

            {/* Stats */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Stats
              </p>
              <div className="space-y-1 text-sm text-gray-700">
                <p>
                  <span className="font-medium">{detail.managers.length}</span> manager
                  {detail.managers.length !== 1 ? 's' : ''}
                </p>
                <p>
                  <span className="font-medium">{detail.members.length}</span> member
                  {detail.members.length !== 1 ? 's' : ''}
                </p>
                <p>
                  <span className="font-medium">{detail.children.length}</span> subgroup
                  {detail.children.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Group colour */}
            {callerRole === 'leader' && canAssignLeader && detail && (
              <div>
                <p className="text-sm font-medium text-gray-500 mb-2">Group colour</p>
                <ColorPicker
                  currentColor={detail.color}
                  groupName={detail.name}
                  groupPk={detail.pk}
                  onColorChange={() => void queryClient.invalidateQueries({ queryKey: ['group', detail.name] })}
                />
              </div>
            )}

            {/* Action buttons */}
            {callerRole === 'leader' && canAssignLeader && (
              <div className="space-y-2">
                <button
                  className="w-full rounded border border-dashed border-red-300 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  onClick={() => setShowResignLeader(true)}
                >
                  Resign as leader
                </button>
                <button
                  className="w-full rounded border border-dashed border-red-400 py-2 text-sm text-red-700 hover:bg-red-50 transition-colors"
                  onClick={() => setShowDisband(true)}
                >
                  Disband group
                </button>
              </div>
            )}
          </div>

          {/* Right — roster */}
          <div className="flex-1 space-y-6">
            {/* Managers */}
            {detail.managers.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Managers
                </p>
                <div className="space-y-1">
                  {detail.managers.map((m) => (
                    <div
                      key={m.uuid}
                      className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded group"
                    >
                      <CrownIcon variant="silver" size="sm" />
                      <Link
                        to={`/users/${m.username}`}
                        className="text-sm text-gray-800 hover:underline flex-1 min-w-0 truncate"
                      >
                        {m.name}
                      </Link>
                      {canManage && (
                        <button
                          className="text-xs text-red-500 hover:text-red-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeManagerMutation.mutate({ userPk: m.pk })}
                          disabled={removeManagerMutation.isPending}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Members */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Members
                </p>
                {canManage && (
                  <button
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    onClick={() => setShowAddMember(true)}
                  >
                    + Add member
                  </button>
                )}
              </div>
              {detail.members.length > 0 ? (
                <div className="space-y-1">
                  {detail.members.map((m) => (
                    <div
                      key={m.uuid}
                      className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded group"
                    >
                      <Link
                        to={`/users/${m.username}`}
                        className="text-sm text-gray-800 hover:underline flex-1 min-w-0 truncate"
                      >
                        {m.name}
                      </Link>
                      {canManage && (
                        <button
                          className="text-xs text-red-500 hover:text-red-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeMemberMutation.mutate({ userPk: m.pk })}
                          disabled={removeMemberMutation.isPending}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No regular members.</p>
              )}
            </section>

            {/* Subgroups */}
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Subgroups
              </p>
              {detail.children.length > 0 ? (
                <div className="space-y-1">
                  {detail.children.map((child) => (
                    <div key={child.pk} className="py-1.5 px-2">
                      <Link
                        to={'/groups/' + encodeURIComponent(child.name)}
                        className="text-sm text-indigo-600 hover:underline"
                      >
                        {child.name}
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No subgroups.</p>
              )}

              {callerRole === 'leader' && canAssignLeader && (
                <div className="mt-3 space-y-2">
                  <button
                    className="w-full rounded border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
                    onClick={() => setShowCreateSubgroup(true)}
                  >
                    + Create subgroup
                  </button>
                  <button
                    className="w-full rounded border border-dashed border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                    onClick={() => setShowAddChildGroup(true)}
                  >
                    + Connect existing group
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default GroupPage;
