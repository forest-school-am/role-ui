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
  groupName: string;
  detail: GroupDetail | undefined | null;
  activeModal: GroupModalName | null;
  close: () => void;
  onDisbandSuccess: () => void;
}

const GroupModalsRenderer: React.FC<GroupModalsRendererProps> = ({
  groupName,
  detail,
  activeModal,
  close,
  onDisbandSuccess,
}) => (
  <>
    {activeModal === 'addMember' && (
      <AddMemberModal
        groupName={groupName}
        onClose={close}
      />
    )}
    {activeModal === 'createSubgroup' && (
      <CreateSubgroupModal
        groupName={groupName}
        onClose={close}
      />
    )}
    {activeModal === 'addChildGroup' && (
      <AddChildGroupModal
        parentGroupName={groupName}
        onClose={close}
      />
    )}
    {activeModal === 'resignLeader' && detail && (
      <ResignLeaderModal
        groupName={groupName}
        members={[...(detail.members.manager ?? []), ...(detail.members.member ?? [])]}
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
