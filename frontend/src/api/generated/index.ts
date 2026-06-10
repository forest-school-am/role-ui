export * from './api';

import { getAuthentikRoleUIBackend } from './api';

export const {
  searchUsers,
  getMe,
  patchMyAttributes,
  getUser,
  getGroups,
  getGroup,
  disbandGroup,
  addMember,
  removeMember,
  addManager,
  removeManager,
  addLeader,
  removeLeader,
  resignLeader,
  createSubgroup,
  addChildGroup,
  detachChildGroup,
  setGoogleSync,
  setGroupColor,
  searchAll,
  getSearchLinkGen,
} = getAuthentikRoleUIBackend();
