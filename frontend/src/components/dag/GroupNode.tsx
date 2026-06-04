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
  const onSelect = data.onSelect as (groupPk: string, groupName: string) => void;
  const groupPk = data.groupPk as string;
  const onMemberClick = data.onMemberClick as (username: string) => void;
  const isVirtual = !!data.isVirtual;

  const headerColor = detail?.color ?? '#e2e8f0'; // default gray-200

  const wrapperClass = 'rounded-lg border border-gray-300 bg-white shadow-md min-w-[200px] max-w-[260px] overflow-hidden cursor-pointer';

  return (
    <div
      className={wrapperClass}
      onClick={() => onSelect(groupPk, groupName)}
    >
      {/* Target handle (left side — incoming edges from parents) */}
      <Handle type="target" position={Position.Left} />

      {/* Header */}
      <div
        className="px-3 py-2"
        style={{
          backgroundColor: headerColor,
          ...(isVirtual ? {
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.45) 8px, rgba(255,255,255,0.45) 12px)',
          } : {}),
        }}
      >
        <p className="text-sm font-semibold truncate">{groupName}</p>
        {isVirtual && (
          <p className="text-xs text-gray-500 italic leading-none mt-0.5">virtual</p>
        )}
      </div>

      {/* Body */}
      <div
        className="px-2 py-2 space-y-0.5 max-h-48 overflow-y-auto"
      >
        {detail === null ? (
          <div className="space-y-1.5 py-1">
            <div className="h-3 rounded bg-gray-200 animate-pulse w-3/4" />
            <div className="h-3 rounded bg-gray-200 animate-pulse w-1/2" />
          </div>
        ) : (
          <>
            {detail.leader && (
              <GroupMemberItem
                member={detail.leader}
                crownVariant="gold"
                onMemberClick={onMemberClick}
              />
            )}
            {detail.managers.map((m) => (
              <GroupMemberItem
                key={m.uuid}
                member={m}
                crownVariant="silver"
                onMemberClick={onMemberClick}
              />
            ))}
            {detail.members.map((m) => (
              <GroupMemberItem
                key={m.uuid}
                member={m}
                onMemberClick={onMemberClick}
              />
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
