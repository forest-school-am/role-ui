import React from 'react';
import type { GroupMember, CrownVariant } from '../../types';
import CrownIcon from '../CrownIcon';

interface GroupMemberItemProps {
  member: GroupMember;
  crownVariant?: CrownVariant;
  onMemberClick: (username: string) => void;
}

const GroupMemberItem: React.FC<GroupMemberItemProps> = ({
  member,
  crownVariant,
  onMemberClick,
}) => {
  return (
    <div
      className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 text-sm text-gray-800"
      onClick={(e) => {
        e.stopPropagation();
        onMemberClick(member.username);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          onMemberClick(member.username);
        }
      }}
    >
      {crownVariant && <CrownIcon variant={crownVariant} size="sm" />}
      <span>{member.name}</span>
    </div>
  );
};

export default GroupMemberItem;
