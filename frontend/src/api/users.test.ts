import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from './client';
import { getMe, getUser, searchUsers } from './users';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockGet = (apiClient as unknown as { get: ReturnType<typeof vi.fn> }).get;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMe', () => {
  it('GET /api/users/me', async () => {
    const user = { username: 'alice', name: 'Alice', is_active: true, logins: [], groups: { leader: [], manager: [], member: [] }, attributes: [] };
    mockGet.mockResolvedValue({ data: user });
    const result = await getMe();
    expect(mockGet).toHaveBeenCalledWith('/api/users/me');
    expect(result).toEqual(user);
  });
});

describe('getUser', () => {
  it('GET /api/users/:username URL-encoded', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await getUser('alice.chen');
    expect(mockGet).toHaveBeenCalledWith('/api/users/alice.chen');
  });

  it('URL-encodes usernames with spaces', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await getUser('alice chen');
    expect(mockGet).toHaveBeenCalledWith('/api/users/alice%20chen');
  });
});

describe('searchUsers', () => {
  it('GET /api/users with search param', async () => {
    const links = [{ username: 'alice', name: 'Alice' }];
    mockGet.mockResolvedValue({ data: links });
    const result = await searchUsers('ali');
    expect(mockGet).toHaveBeenCalledWith('/api/users', { params: { search: 'ali' } });
    expect(result).toEqual(links);
  });
});
