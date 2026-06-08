import { getMe, getUser, searchUsers as _searchUsers } from './generated';

export { getMe, getUser };

export const searchUsers = (term: string) => _searchUsers({ search: term });
