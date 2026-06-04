import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getGroups } from '../api/groups';
import DAGCanvas from '../components/dag/DAGCanvas';
import GroupPreviewPanel from '../components/panels/GroupPreviewPanel';
import UserPreviewPanel from '../components/panels/UserPreviewPanel';
import type { PanelState } from '../types';

const StructurePage: React.FC = () => {
  const [panel, setPanel] = useState<PanelState>({ kind: 'none' });
  const [searchParams] = useSearchParams();
  const focusGroupId = searchParams.get('focus');

  const {
    data: groups,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
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
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-1">Error</h2>
          <p className="text-sm">{message}</p>
        </div>
      </div>
    );
  }

  const resolvedGroups = groups ?? [];

  return (
    <div className="relative w-full h-full bg-gray-50">
      <DAGCanvas
        groups={resolvedGroups}
        onGroupSelect={(pk, name) => setPanel({ kind: 'groupPreview', groupPk: pk, groupName: name })}
        onMemberClick={(username) => setPanel({ kind: 'userPreview', username })}
        focusNodeId={focusGroupId}
      />

      {panel.kind === 'userPreview' && (
        <UserPreviewPanel
          username={panel.username}
          onClose={() => setPanel({ kind: 'none' })}
        />
      )}
      {panel.kind === 'groupPreview' && (
        <GroupPreviewPanel
          groupPk={panel.groupPk}
          groupName={panel.groupName}
          onClose={() => setPanel({ kind: 'none' })}
        />
      )}
    </div>
  );
};

export default StructurePage;
