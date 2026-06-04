import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GroupMember, CrownVariant } from '../../types';
import CrownIcon from '../CrownIcon';

interface GroupMemberItemProps {
  member: GroupMember;
  crownVariant?: CrownVariant;
}

const GroupMemberItem: React.FC<GroupMemberItemProps> = ({
  member,
  crownVariant,
}) => {
  const navigate = useNavigate();

  return (
    <div
      className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 text-sm text-gray-800"
      onClick={() => navigate(`/users/${member.uuid}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(`/users/${member.uuid}`);
      }}
    >
      {crownVariant && <CrownIcon variant={crownVariant} size="sm" />}
      <span>{member.name}</span>
    </div>
  );
};

export default GroupMemberItem;
