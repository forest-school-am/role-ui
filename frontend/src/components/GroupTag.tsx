import React from 'react';
import type { GroupRole } from '../types';
import CrownIcon from './CrownIcon';

interface GroupTagProps {
  groupName: string;
  role: GroupRole;
  onClick?: () => void;
}

const GroupTag: React.FC<GroupTagProps> = ({ groupName, role, onClick }) => {
  const base =
    'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium border select-none';

  const colorClass =
    role === 'leader'
      ? 'bg-yellow-50 border-yellow-300 text-yellow-900'
      : role === 'manager'
        ? 'bg-slate-100 border-slate-300 text-slate-700'
        : 'bg-gray-50 border-gray-200 text-gray-700';

  const interactiveClass = onClick
    ? 'cursor-pointer hover:opacity-80 transition-opacity'
    : '';

  return (
    <span
      className={`${base} ${colorClass} ${interactiveClass}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
    >
      {role === 'leader' && <CrownIcon variant="gold" size="sm" />}
      {role === 'manager' && <CrownIcon variant="silver" size="sm" />}
      <span>{groupName}</span>
    </span>
  );
};

export default GroupTag;
