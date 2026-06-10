import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { GroupDetail, GroupNodeData } from '../../types';
import GroupNodeContent from './GroupNodeContent';

export type GroupNodeType = Node<GroupNodeData, 'groupNode'>;

const GroupNode: React.FC<NodeProps<GroupNodeType>> = ({ data }) => {
  const groupName = data.groupName as string;
  const detail = data.detail as GroupDetail | null;
  const onSelect = data.onSelect as (groupName: string, isVirtual?: boolean) => void;
  const onMemberClick = data.onMemberClick as (username: string) => void;
  const isVirtual = !!data.isVirtual;

  return (
    <>
      <Handle type="target" position={Position.Left} />
      <GroupNodeContent
        groupName={groupName}
        detail={detail}
        isVirtual={isVirtual}
        onSelect={onSelect}
        onMemberClick={onMemberClick}
      />
      <Handle type="source" position={Position.Right} />
    </>
  );
};

export default GroupNode;
