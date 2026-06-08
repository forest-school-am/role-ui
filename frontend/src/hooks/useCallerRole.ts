import { useMemo } from 'react';
import type { GroupDetail, GroupRole, User } from '../types';

export function useCallerRole(
  detail: GroupDetail | undefined | null,
  me: User | undefined | null,
): GroupRole | 'non-member' {
  return useMemo(() => {
    if (!detail || !me) return 'non-member';
    const name = detail.name;
    if (me.groups.leader.some((g) => g.name === name)) return 'leader';
    if (me.groups.manager.some((g) => g.name === name)) return 'manager';
    if (me.groups.member.some((g) => g.name === name)) return 'member';
    return 'non-member';
  }, [detail, me]);
}
