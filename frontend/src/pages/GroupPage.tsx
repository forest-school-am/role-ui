import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getGroup, getGroups, removeMember, removeManager, addManager } from '../api/groups';
import { extractApiError } from '../api/client';
import { invalidateGroup } from '../api/groupQueryHelpers';
import { getMe } from '../api/users';
import CrownIcon from '../components/CrownIcon';
import ColorPicker from '../components/dag/ColorPicker';
import PageLoadingSkeleton from '../components/ui/PageLoadingSkeleton';
import PageErrorCard from '../components/ui/PageErrorCard';
import DashedButton from '../components/ui/DashedButton';
import MutationErrorBanner from '../components/ui/MutationErrorBanner';
import EmptyNote from '../components/ui/EmptyNote';
import GroupModalsRenderer from '../components/panels/GroupModalsRenderer';
import { useCallerRole } from '../hooks/useCallerRole';
import { useGroupModals } from '../hooks/useGroupModals';
import { SECTION_LABEL_CLS, MINI_LINK_BTN_CLS, MEMBER_ROW_CLS } from '../lib/ui-constants';

const GroupPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const groupName = name ?? '';
  const navigate = useNavigate();

  const { activeModal, open, close } = useGroupModals();
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

  const callerRole = useCallerRole(detail, me);

  const removeMemberMutation = useMutation({
    mutationFn: ({ userPk }: { userPk: number }) => removeMember(groupName, userPk),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const removeManagerMutation = useMutation({
    mutationFn: ({ userPk }: { userPk: number }) => removeManager(groupName, userPk),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const addManagerMutation = useMutation({
    mutationFn: ({ userPk }: { userPk: number }) => addManager(groupName, userPk),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  if (detailLoading) {
    return <PageLoadingSkeleton />;
  }

  if (detailError) {
    const message =
      detailErrorObj instanceof Error ? detailErrorObj.message : 'Failed to load group.';
    const isNotFound = message.toLowerCase().includes('not found');
    return (
      <PageErrorCard
        title={isNotFound ? 'Group not found' : 'Error'}
        message={message}
      />
    );
  }

  if (!detail) return null;

  const resolvedGroups = allGroups ?? [];
  const canManage = callerRole === 'leader' || callerRole === 'manager';

  return (
    <>
      <GroupModalsRenderer
        groupPk={detail.pk}
        groupName={detail.name}
        detail={detail}
        activeModal={activeModal}
        close={close}
        onDisbandSuccess={() => navigate('/structure')}
      />

      <div className="max-w-5xl mx-auto p-8">
        <MutationErrorBanner message={mutationError} />

        <div className="flex flex-col md:flex-row gap-8 mt-2">
          {/* Left — identity */}
          <div className="flex-none w-full md:w-64 space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">{detail.name}</h1>

            <button
              className="flex items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 transition-colors"
              onClick={() => navigate(`/structure?focus=${encodeURIComponent(detail.name)}`)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><circle cx="5" cy="19" r="3"/>
                <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="19" y2="16"/><line x1="12" y1="12" x2="5" y2="16"/>
              </svg>
              View in graph
            </button>

            {/* Parent groups */}
            {detail.parent_pks.length > 0 && (
              <div>
                <p className={`${SECTION_LABEL_CLS} mb-1`}>Parent Groups</p>
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

            {/* Stats */}
            <div>
              <p className={`${SECTION_LABEL_CLS} mb-2`}>Stats</p>
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
            {callerRole === 'leader' && detail && (
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
            {callerRole === 'leader' && (
              <div className="space-y-2">
                <DashedButton color="red" onClick={() => open('resignLeader')}>
                  Resign as leader
                </DashedButton>
                <DashedButton color="red" variant="dark" onClick={() => open('disband')}>
                  Disband group
                </DashedButton>
              </div>
            )}
          </div>

          {/* Right — roster */}
          <div className="flex-1 space-y-6">
            {/* Leader */}
            <section>
              <p className={`${SECTION_LABEL_CLS} mb-2`}>Leader</p>
              {detail.leader ? (
                <div className="flex items-center gap-2 py-1.5 px-2">
                  <CrownIcon variant="gold" size="sm" />
                  <Link
                    to={`/users/${detail.leader.username}`}
                    className="text-sm text-gray-800 hover:underline flex-1 min-w-0 truncate"
                  >
                    {detail.leader.name}
                  </Link>
                </div>
              ) : (
                <EmptyNote>No leader</EmptyNote>
              )}
            </section>

            {/* Managers */}
            {detail.managers.length > 0 && (
              <section>
                <p className={`${SECTION_LABEL_CLS} mb-2`}>Managers</p>
                <div className="space-y-1">
                  {detail.managers.map((m) => (
                    <div key={m.uuid} className={MEMBER_ROW_CLS}>
                      <CrownIcon variant="silver" size="sm" />
                      <Link
                        to={`/users/${m.username}`}
                        className="text-sm text-gray-800 hover:underline flex-1 min-w-0 truncate"
                      >
                        {m.name}
                      </Link>
                      {callerRole === 'leader' && (
                        <button
                          className="text-xs text-orange-500 hover:text-orange-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeManagerMutation.mutate({ userPk: m.pk })}
                          disabled={removeManagerMutation.isPending}
                        >
                          {removeManagerMutation.isPending ? '…' : '← Member'}
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
                <p className={SECTION_LABEL_CLS}>Members</p>
                {canManage && (
                  <button
                    className={`${MINI_LINK_BTN_CLS} font-medium`}
                    onClick={() => open('addMember')}
                  >
                    + Add member
                  </button>
                )}
              </div>
              {detail.members.length > 0 ? (
                <div className="space-y-1">
                  {detail.members.map((m) => (
                    <div key={m.uuid} className={MEMBER_ROW_CLS}>
                      <Link
                        to={`/users/${m.username}`}
                        className="text-sm text-gray-800 hover:underline flex-1 min-w-0 truncate"
                      >
                        {m.name}
                      </Link>
                      {callerRole === 'leader' && (
                        <button
                          className="text-xs text-indigo-500 hover:text-indigo-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => addManagerMutation.mutate({ userPk: m.pk })}
                          disabled={addManagerMutation.isPending}
                        >
                          {addManagerMutation.isPending ? '…' : '→ Manager'}
                        </button>
                      )}
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
                <EmptyNote>No regular members.</EmptyNote>
              )}
            </section>

            {/* Subgroups */}
            <section>
              <p className={`${SECTION_LABEL_CLS} mb-2`}>Subgroups</p>
              {detail.children.length > 0 ? (
                <div className="space-y-1">
                  {detail.children.map((child) => (
                    <div key={child.pk} className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded">
                      <Link
                        to={'/groups/' + encodeURIComponent(child.name)}
                        className="text-sm text-gray-800 hover:underline flex-1 min-w-0 truncate"
                      >
                        {child.name}
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyNote>No subgroups.</EmptyNote>
              )}

              {callerRole === 'leader' && (
                <div className="mt-3 space-y-2">
                  <DashedButton color="indigo" onClick={() => open('createSubgroup')}>
                    + Create subgroup
                  </DashedButton>
                  <DashedButton color="gray" onClick={() => open('addChildGroup')}>
                    + Connect existing group
                  </DashedButton>
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
