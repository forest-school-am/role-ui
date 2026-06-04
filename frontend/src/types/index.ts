// Roles a user can have within a single group
export type GroupRole = "leader" | "manager" | "member";

// A compact group membership entry on a user's profile
export interface GroupMembership {
  group_pk: string;      // UUID
  group_name: string;
  role: GroupRole;
}

// Full user profile (response from GET /api/users/me and GET /api/users/:uuid)
export interface User {
  pk: number;
  uuid: string;          // UUID
  username: string;
  name: string;
  email: string;
  is_active: boolean;
  telegram: string | null;
  groups: GroupMembership[];
}

// Summary of a group, used in the groups list (GET /api/groups)
export interface GroupSummary {
  pk: string;            // UUID
  name: string;
  is_superuser: boolean;
  parent_pks: string[];  // UUID[]
  leader_uuid: string | null;  // UUID
  manager_uuids: string[];     // UUID[]
  member_count: number;
}

// Full group list response
export interface GroupListResponse {
  groups: GroupSummary[];
}

// A single member inside a group detail response
export interface GroupMember {
  pk: number;
  uuid: string;          // UUID
  username: string;
  name: string;
  email: string;
  is_active: boolean;
  telegram: string | null;
}

// Full group detail (response from GET /api/groups/:groupPk)
export interface GroupDetail {
  pk: string;            // UUID
  name: string;
  is_superuser: boolean;
  parent_pks: string[];  // UUID[]
  leader: GroupMember | null;
  managers: GroupMember[];
  members: GroupMember[];
}

// Mutation success response (used for add/remove member, manager, leader)
export interface MutationSuccess {
  ok: true;
}

// Error response from backend
export interface ApiError {
  error: string;
}

// React Flow node data payload for GroupNode
export interface GroupNodeData extends Record<string, unknown> {
  groupPk: string;
  groupName: string;
  detail: GroupDetail | null;
  onSelect: (groupPk: string) => void;
}

// CrownIcon variant
export type CrownVariant = "gold" | "silver";

// CrownIcon size
export type CrownSize = "sm" | "md";
