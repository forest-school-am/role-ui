import React from 'react';
import type { UserLink, CrownVariant } from '../../types';
import CrownIcon from '../CrownIcon';
import { MEMBER_ROW_CLS } from '../../lib/ui-constants';

interface UserRowProps {
  member: UserLink;
  crownVariant?: CrownVariant;
  onUserClick?: (username: string) => void;
  actions?: React.ReactNode;
}

const UserRow: React.FC<UserRowProps> = ({ member, crownVariant, onUserClick, actions }) => (
  <div className={MEMBER_ROW_CLS}>
    <span className="w-4 flex-none flex items-center">
      {crownVariant && <CrownIcon variant={crownVariant} size="sm" />}
    </span>
    <span
      className={`text-sm text-gray-800 flex-1 truncate${onUserClick ? ' cursor-pointer hover:text-indigo-600' : ''}`}
      onClick={onUserClick ? (e) => { e.stopPropagation(); onUserClick(member.username); } : undefined}
      title={member.name}
    >
      {member.name}
    </span>
    {actions}
  </div>
);

export default UserRow;
