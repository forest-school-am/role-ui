// Core API types from the generated client
export type {
  GroupRole,
  UserLink,
  GroupLink,
  LoginAccount,
  User,
  Group,
  GroupRoleSplit,
  UserGroupRoleSplit,
  SearchResult,
  SearchResultUser,
  SearchResultGroup,
  ApiError,
} from '../api/generated/api';

// Backward-compatible aliases used throughout the codebase
export type { GroupRoleSplit as GroupMembersByRole } from '../api/generated/api';
export type { UserGroupRoleSplit as UserGroupsByRole } from '../api/generated/api';

// GroupDetail extends the API Group with the frontend-only is_virtual flag
import type { Group } from '../api/generated/api';
export type GroupDetail = Group & { is_virtual?: boolean };

// UI-only types (not part of the API)
export type CrownVariant = 'gold' | 'silver';
export type CrownSize = 'sm' | 'md';

export interface GroupNodeData extends Record<string, unknown> {
  groupName: string;
  detail: GroupDetail | null;
  onSelect: (groupName: string, isVirtual?: boolean) => void;
  onMemberClick: (username: string) => void;
  isVirtual?: boolean;
}

export type PanelState =
  | { kind: 'none' }
  | { kind: 'groupPreview'; groupName: string; isVirtual?: boolean }
  | { kind: 'userPreview'; username: string };
