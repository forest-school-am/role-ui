import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGroups } from '../api/groups';
import { getMe } from '../api/users';
import DAGCanvas from '../components/dag/DAGCanvas';
import GroupDetailPanel from '../components/panels/GroupDetailPanel';
import type { GroupRole } from '../types';

const StructurePage: React.FC = () => {
  const [selectedGroupPk, setSelectedGroupPk] = useState<string | null>(null);

  const {
    data: groups,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm animate-pulse">
          Loading group structure…
        </p>
      </div>
    );
  }

  if (isError) {
    const message =
      error instanceof Error ? error.message : 'Failed to load groups.';
    return (
      <div className="flex h-screen items-center justify-center p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-1">Error</h2>
          <p className="text-sm">{message}</p>
        </div>
      </div>
    );
  }

  const resolvedGroups = groups ?? [];

  // Derive the current user's role in the selected group.
  // Includes one-level inheritance: leader of a direct parent acts as leader.
  const callerRole: GroupRole | 'non-member' = (() => {
    if (!selectedGroupPk || !me) return 'non-member';

    const membership = me.groups.find((g) => g.group_pk === selectedGroupPk);
    if (membership) return membership.role;

    // Check if user is leader of any direct parent of the selected group.
    const selectedGroup = resolvedGroups.find((g) => g.pk === selectedGroupPk);
    if (selectedGroup) {
      for (const parentPk of selectedGroup.parent_pks) {
        const parentMembership = me.groups.find((g) => g.group_pk === parentPk);
        if (parentMembership?.role === 'leader') return 'leader';
      }
    }

    return 'non-member';
  })();

  return (
    <div className="relative w-full h-screen bg-gray-50">
      <DAGCanvas
        groups={resolvedGroups}
        onGroupSelect={(pk) => setSelectedGroupPk(pk)}
      />

      {selectedGroupPk && (
        <GroupDetailPanel
          groupPk={selectedGroupPk}
          callerRole={callerRole}
          onClose={() => setSelectedGroupPk(null)}
        />
      )}
    </div>
  );
};

export default StructurePage;
