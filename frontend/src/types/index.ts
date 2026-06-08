// Roles a user can have within a single group
export type GroupRole = "leader" | "manager" | "member";

// A login/contact account stored on a user (email, telegram, google, …)
export interface LoginAccount {
  kind: string;    // "email" | "telegram" | "google" | ...
  address: string;
}

// Minimal user info used inside group member lists and search results
export interface UserLink {
  username: string;
  name: string;
}

// Minimal group info used inside user profiles, parent/child lists
export interface GroupLink {
  name: string;
}

// Group members organised by role (backend: RoleSplit<UserLink>)
export interface GroupMembersByRole {
  leader: UserLink[];
  manager: UserLink[];
  member: UserLink[];
}

// User's group memberships organised by role (backend: RoleSplit<GroupLink>)
export interface UserGroupsByRole {
  leader: GroupLink[];
  manager: GroupLink[];
  member: GroupLink[];
}

// Full user profile (response from GET /api/users/me and GET /api/users/:username)
export interface User {
  username: string;
  name: string;
  is_active: boolean;
  logins: LoginAccount[];
  groups: UserGroupsByRole;
  attributes: [string, string][];
}

// Full group detail (response from GET /api/groups and GET /api/groups/:name)
export interface GroupDetail {
  name: string;
  members: GroupMembersByRole;
  children: GroupLink[];
  parents: GroupLink[];
  color?: string;
  is_virtual?: boolean;
}

// Mutation success response (used for add/remove member, manager, leader)
export interface MutationSuccess {
  ok: true;
}

// React Flow node data payload for GroupNode
export interface GroupNodeData extends Record<string, unknown> {
  groupName: string;
  detail: GroupDetail | null;
  onSelect: (groupName: string, isVirtual?: boolean) => void;
  onMemberClick: (username: string) => void;
  isVirtual?: boolean;
}

// Discriminated union for the active panel state in StructurePage
export type PanelState =
  | { kind: 'none' }
  | { kind: 'groupPreview'; groupName: string; isVirtual?: boolean }
  | { kind: 'userPreview'; username: string };

// CrownIcon variant
export type CrownVariant = "gold" | "silver";

// CrownIcon size
export type CrownSize = "sm" | "md";
