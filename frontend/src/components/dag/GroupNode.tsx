import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { GroupDetail, GroupNodeData } from '../../types';
import GroupMemberItem from './GroupMemberItem';

// React Flow custom node type: a Node whose .data is GroupNodeData
export type GroupNodeType = Node<GroupNodeData, 'groupNode'>;

const GroupNode: React.FC<NodeProps<GroupNodeType>> = ({ data }) => {
  const groupName = data.groupName as string;
  const detail = data.detail as GroupDetail | null;
  const onSelect = data.onSelect as (groupPk: string) => void;
  const groupPk = data.groupPk as string;

  return (
    <div
      className="rounded-lg border border-gray-300 bg-white shadow-md min-w-[200px] max-w-[260px] overflow-hidden cursor-pointer"
      onClick={() => onSelect(groupPk)}
    >
      {/* Target handle (left side — incoming edges from parents) */}
      <Handle type="target" position={Position.Left} />

      {/* Header */}
      <div className="bg-indigo-600 px-3 py-2">
        <p className="text-white text-sm font-semibold truncate">{groupName}</p>
      </div>

      {/* Body */}
      <div className="px-2 py-2 space-y-0.5 max-h-48 overflow-y-auto">
        {detail === null ? (
          <div className="space-y-1.5 py-1">
            <div className="h-3 rounded bg-gray-200 animate-pulse w-3/4" />
            <div className="h-3 rounded bg-gray-200 animate-pulse w-1/2" />
          </div>
        ) : (
          <>
            {detail.leader && (
              <GroupMemberItem member={detail.leader} crownVariant="gold" />
            )}
            {detail.managers.map((m) => (
              <GroupMemberItem key={m.uuid} member={m} crownVariant="silver" />
            ))}
            {detail.members.map((m) => (
              <GroupMemberItem key={m.uuid} member={m} />
            ))}
            {!detail.leader &&
              detail.managers.length === 0 &&
              detail.members.length === 0 && (
                <p className="text-xs text-gray-400 italic px-1">Empty group</p>
              )}
          </>
        )}
      </div>

      {/* Source handle (right side — outgoing edges to children) */}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export default GroupNode;
