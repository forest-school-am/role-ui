import { useMemo } from 'react';
import type { GroupDetail, GroupRole, User } from '../types';

/**
 * Derives the calling user's role in a group.
 * Returns 'non-member' when either argument is absent or the user has no membership.
 */
export function useCallerRole(
  detail: GroupDetail | undefined | null,
  me: User | undefined | null,
): GroupRole | 'non-member' {
  return useMemo(() => {
    if (!detail || !me) return 'non-member';
    const membership = me.groups.find((g) => g.group_pk === detail.pk);
    return membership ? membership.role : 'non-member';
  }, [detail, me]);
}
