import { getMe, getUser, searchUsers as _searchUsers, patchMyAttributes as _patchMyAttributes } from './generated';

export { getMe, getUser };

export const searchUsers = (term: string) => _searchUsers({ search: term });

export const patchMyAttributes = (attributes: Record<string, string>) =>
  _patchMyAttributes({ attributes });
