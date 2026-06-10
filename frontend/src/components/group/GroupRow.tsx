import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { detachChildGroup } from '../../api/groups';
import { extractApiError } from '../../api/client';
import { invalidateGroup } from '../../api/groupQueryHelpers';
import type { GroupLink } from '../../types';

interface GroupRowProps {
  child: GroupLink;
  parentGroupName: string;
  canDetach: boolean;
}

const GroupRow: React.FC<GroupRowProps> = ({ child, parentGroupName, canDetach }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const detachMutation = useMutation({
    mutationFn: () => detachChildGroup(parentGroupName, child.name),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, parentGroupName);
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  return (
    <>
      <div className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-gray-50 group">
        <span className="w-4 flex-none" />
        <span
          className="text-xs text-gray-800 flex-1 truncate cursor-pointer hover:text-indigo-600"
          onClick={() => navigate(`/groups/${encodeURIComponent(child.name)}`)}
        >
          {child.name}
        </span>
        {canDetach && (
          <button
            className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
            onClick={() => {
              if (window.confirm(`Detach "${child.name}" from this group?`)) {
                detachMutation.mutate();
              }
            }}
            disabled={detachMutation.isPending}
            title="Detach subgroup"
          >
            {detachMutation.isPending ? '…' : '×'}
          </button>
        )}
      </div>
      {mutationError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mx-3 mb-2">
          {mutationError}
        </p>
      )}
    </>
  );
};

export default GroupRow;
