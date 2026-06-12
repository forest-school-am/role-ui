import React from 'react';
import type { GroupDetail } from '../../types';
import UserRow from '../user/UserRow';

interface GroupNodeContentProps {
  groupName: string;
  detail: GroupDetail | null;
  isVirtual?: boolean;
  onSelect?: (groupName: string, isVirtual?: boolean) => void;
  onMemberClick?: (username: string) => void;
}

const GroupNodeContent: React.FC<GroupNodeContentProps> = ({
  groupName,
  detail,
  isVirtual = false,
  onSelect,
  onMemberClick,
}) => {
  const headerColor = detail?.color ?? '#e2e8f0';

  return (
    <div
      className="rounded-lg border border-gray-300 bg-white shadow-md min-w-[200px] max-w-[260px] overflow-hidden cursor-pointer" /* 260 = NODE_CONTENT_WIDTH in dag/layouts/types.ts */
      onClick={onSelect ? () => onSelect(groupName, isVirtual) : undefined}
    >
      <div
        className="px-3 py-2"
        style={{
          backgroundColor: headerColor,
          ...(isVirtual
            ? {
                backgroundImage:
                  'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.45) 8px, rgba(255,255,255,0.45) 12px)',
              }
            : {}),
        }}
      >
        <p className="text-sm font-semibold truncate">{groupName}</p>
        {isVirtual && (
          <p className="text-xs text-gray-500 italic leading-none mt-0.5">virtual</p>
        )}
      </div>

      <div className="px-2 py-2 space-y-0.5">
        {detail === null ? (
          <div className="space-y-1.5 py-1">
            <div className="h-3 rounded bg-gray-200 animate-pulse w-3/4" />
            <div className="h-3 rounded bg-gray-200 animate-pulse w-1/2" />
          </div>
        ) : (
          <>
            {[...detail.members.leader].sort((a, b) => a.username.localeCompare(b.username)).map((m) => (
              <UserRow
                key={m.username}
                member={m}
                crownVariant="gold"
                onUserClick={onMemberClick}
              />
            ))}
            {[...detail.members.manager].sort((a, b) => a.username.localeCompare(b.username)).map((m) => (
              <UserRow
                key={m.username}
                member={m}
                crownVariant="silver"
                onUserClick={onMemberClick}
              />
            ))}
            {[...detail.members.member].sort((a, b) => a.username.localeCompare(b.username)).map((m) => (
              <UserRow key={m.username} member={m} onUserClick={onMemberClick} />
            ))}
            {detail.members.leader.length === 0 &&
              detail.members.manager.length === 0 &&
              detail.members.member.length === 0 && (
                <p className="text-xs text-gray-400 italic px-1">Empty group</p>
              )}
          </>
        )}
      </div>
    </div>
  );
};

export default GroupNodeContent;
