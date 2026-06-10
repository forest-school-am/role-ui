import {
  getGroups,
  getGroup,
  disbandGroup,
  removeMember,
  removeManager,
  removeLeader,
  detachChildGroup,
  addMember as _addMember,
  addManager as _addManager,
  addLeader as _addLeader,
  resignLeader as _resignLeader,
  createSubgroup as _createSubgroup,
  addChildGroup as _addChildGroup,
  setGroupColor as _setGroupColor,
  setGoogleSync as _setGoogleSync,
} from './generated';

export { getGroups, getGroup, disbandGroup, removeMember, removeManager, removeLeader, detachChildGroup };

export const addLeader = (groupName: string, username: string) =>
  _addLeader(groupName, { username });

export const addMember = (groupName: string, username: string) =>
  _addMember(groupName, { username });

export const addManager = (groupName: string, username: string) =>
  _addManager(groupName, { username });

export const resignLeader = (groupName: string, successorUsername: string) =>
  _resignLeader(groupName, { username: successorUsername });

export const createSubgroup = (groupName: string, name: string) =>
  _createSubgroup(groupName, { name });

export const addChildGroup = (parentGroupName: string, childGroupName: string) =>
  _addChildGroup(parentGroupName, { group_name: childGroupName });

export const setGroupColor = (groupName: string, color: string) =>
  _setGroupColor(groupName, { color });

export const setGoogleSync = (
  groupName: string,
  recursive_name?: string,
  direct_name?: string,
) => _setGoogleSync(groupName, { recursive_name, direct_name });
