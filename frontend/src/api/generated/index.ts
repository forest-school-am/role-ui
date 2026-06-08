export * from './api';

import { getAuthentikRoleUIBackend } from './api';

export const {
  searchUsers,
  getMe,
  getUser,
  getGroups,
  getGroup,
  disbandGroup,
  addMember,
  removeMember,
  addManager,
  removeManager,
  resignLeader,
  createSubgroup,
  addChildGroup,
  detachChildGroup,
  setGroupColor,
  searchAll,
  getSearchLinkGen,
} = getAuthentikRoleUIBackend();
