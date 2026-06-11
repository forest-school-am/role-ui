export * from './api';

import { getAuthentikRoleUIBackend } from './api';

export const {
  searchUsers,
  getMe,
  patchMyAttributes,
  setDisplayName,
  toggleNameFreeze,
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
  renameGroup,
  setGoogleSync,
  setGroupColor,
  searchAll,
  getSearchLinkGen,
} = getAuthentikRoleUIBackend();
