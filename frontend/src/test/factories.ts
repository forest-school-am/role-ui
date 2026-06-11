import type { User, GroupDetail, GroupMembersByRole } from '../types';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    username: 'alice',
    name: 'Alice Chen',
    is_active: true,
    is_superuser: false,
    name_frozen: false,
    logins: { google: 'alice@example.com', telegram: 'alice' },
    groups: { leader: [], manager: [], member: [] },
    attributes: [],
    ...overrides,
  };
}

function makeMembers(overrides: Partial<GroupMembersByRole> = {}): GroupMembersByRole {
  return { leader: [], manager: [], member: [], ...overrides };
}

export function makeGroupDetail(overrides: Partial<GroupDetail> = {}): GroupDetail {
  return {
    name: 'Engineering',
    members: makeMembers(),
    children: [],
    parents: [],
    color: undefined,
    is_virtual: false,
    ...overrides,
  };
}
