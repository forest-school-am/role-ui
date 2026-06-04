import React from 'react';
import type { GroupDetail } from '../../types';
import type { GroupModalName } from '../../hooks/useGroupModals';
import {
  AddMemberModal,
  CreateSubgroupModal,
  AddChildGroupModal,
  ResignLeaderModal,
  DisbandGroupModal,
} from './GroupDetailPanel';

interface GroupModalsRendererProps {
  groupPk: string;
  groupName: string;
  detail: GroupDetail | undefined | null;
  activeModal: GroupModalName | null;
  close: () => void;
  onDisbandSuccess: () => void;
}

/**
 * Renders the five conditional modal components for a group.
 * Used by both GroupPage and GroupPreviewPanel to avoid duplication.
 */
const GroupModalsRenderer: React.FC<GroupModalsRendererProps> = ({
  groupPk,
  groupName,
  detail,
  activeModal,
  close,
  onDisbandSuccess,
}) => (
  <>
    {activeModal === 'addMember' && (
      <AddMemberModal
        groupPk={groupPk}
        groupName={groupName}
        onClose={close}
      />
    )}
    {activeModal === 'createSubgroup' && (
      <CreateSubgroupModal
        groupPk={groupPk}
        groupName={groupName}
        onClose={close}
      />
    )}
    {activeModal === 'addChildGroup' && (
      <AddChildGroupModal
        parentGroupPk={groupPk}
        parentGroupName={groupName}
        onClose={close}
      />
    )}
    {activeModal === 'resignLeader' && detail && (
      <ResignLeaderModal
        groupPk={groupPk}
        groupName={groupName}
        members={[...(detail.managers ?? []), ...(detail.members ?? [])]}
        onClose={close}
      />
    )}
    {activeModal === 'disband' && (
      <DisbandGroupModal
        groupName={groupName}
        onClose={close}
        onSuccess={onDisbandSuccess}
      />
    )}
  </>
);

export default GroupModalsRenderer;
