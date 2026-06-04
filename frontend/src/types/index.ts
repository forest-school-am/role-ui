// Roles a user can have within a single group
export type GroupRole = "leader" | "manager" | "member";

// A compact group membership entry on a user's profile
export interface GroupMembership {
  group_pk: string;      // UUID
  group_name: string;
  role: GroupRole;
}

// A social contact entry (email, telegram, google, …)
export interface SocialAccount {
  type: string;
  address: string;
}

// A named SSH public key
export interface SshKey {
  label: string;
  key: string;
}

// Full user profile (response from GET /api/users/me and GET /api/users/:uuid)
export interface User {
  pk: number;
  uuid: string;          // UUID
  username: string;
  name: string;
  is_active: boolean;
  social: SocialAccount[];
  ssh: SshKey[];
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
  color?: string;
  is_virtual?: boolean;
}

// A single member inside a group detail response
export interface GroupMember {
  pk: number;
  uuid: string;          // UUID
  username: string;
  name: string;
  email: string;
  is_active: boolean;
}

// A child group entry inside a group detail response
export interface GroupChild {
  pk: string;
  name: string;
  is_virtual?: boolean;
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
  children: GroupChild[];
  color?: string;
  is_virtual?: boolean;
}

// Mutation success response (used for add/remove member, manager, leader)
export interface MutationSuccess {
  ok: true;
}

// React Flow node data payload for GroupNode
export interface GroupNodeData extends Record<string, unknown> {
  groupPk: string;
  groupName: string;
  detail: GroupDetail | null;
  onSelect: (groupPk: string, groupName: string) => void;
  onMemberClick: (username: string) => void;
  isVirtual?: boolean;
}

// Discriminated union for the active panel state in StructurePage
export type PanelState =
  | { kind: 'none' }
  | { kind: 'groupPreview'; groupPk: string; groupName: string }
  | { kind: 'userPreview'; username: string };

// CrownIcon variant
export type CrownVariant = "gold" | "silver";

// CrownIcon size
export type CrownSize = "sm" | "md";
