import {
  getMe,
  getUser,
  searchUsers as _searchUsers,
  patchMyAttributes as _patchMyAttributes,
  setDisplayName as _setDisplayName,
  toggleNameFreeze,
} from './generated';

export { getMe, getUser, toggleNameFreeze };

export const searchUsers = (term: string) => _searchUsers({ search: term });

export const patchMyAttributes = (attributes: Record<string, string>) =>
  _patchMyAttributes({ attributes });

export const setDisplayName = (name: string) => _setDisplayName({ name });
