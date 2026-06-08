import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from './client';
import {
  getGroups,
  getGroup,
  addMember,
  removeMember,
  addManager,
  removeManager,
  resignLeader,
  createSubgroup,
  disbandGroup,
  setGroupColor,
  detachChildGroup,
} from './groups';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mock = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getGroups', () => {
  it('GET /api/groups and returns the array directly', async () => {
    const groups = [{ name: 'Engineering', members: { leader: [], manager: [], member: [] }, children: [], parents: [] }];
    mock.get.mockResolvedValue({ data: groups });
    const result = await getGroups();
    expect(mock.get).toHaveBeenCalledWith('/api/groups');
    expect(result).toEqual(groups);
  });
});

describe('getGroup', () => {
  it('GET /api/groups/:name (URL-encoded)', async () => {
    mock.get.mockResolvedValue({ data: { name: 'My Group' } });
    await getGroup('My Group');
    expect(mock.get).toHaveBeenCalledWith('/api/groups/My%20Group');
  });
});

describe('addMember', () => {
  it('POST /api/groups/:name/members with { username }', async () => {
    mock.post.mockResolvedValue({ data: { ok: true } });
    await addMember('Engineering', 'bob');
    expect(mock.post).toHaveBeenCalledWith(
      '/api/groups/Engineering/members',
      { username: 'bob' },
    );
  });
});

describe('removeMember', () => {
  it('DELETE /api/groups/:name/members/:username', async () => {
    mock.delete.mockResolvedValue({ data: { ok: true } });
    await removeMember('Engineering', 'bob');
    expect(mock.delete).toHaveBeenCalledWith(
      '/api/groups/Engineering/members/bob',
    );
  });
});

describe('addManager', () => {
  it('POST /api/groups/:name/managers with { username }', async () => {
    mock.post.mockResolvedValue({ data: { ok: true } });
    await addManager('Engineering', 'bob');
    expect(mock.post).toHaveBeenCalledWith(
      '/api/groups/Engineering/managers',
      { username: 'bob' },
    );
  });
});

describe('removeManager', () => {
  it('DELETE /api/groups/:name/managers/:username', async () => {
    mock.delete.mockResolvedValue({ data: { ok: true } });
    await removeManager('Engineering', 'bob');
    expect(mock.delete).toHaveBeenCalledWith(
      '/api/groups/Engineering/managers/bob',
    );
  });
});

describe('resignLeader', () => {
  it('POST /api/groups/:name/leader/resign with { username }', async () => {
    mock.post.mockResolvedValue({ data: { ok: true } });
    await resignLeader('Engineering', 'bob');
    expect(mock.post).toHaveBeenCalledWith(
      '/api/groups/Engineering/leader/resign',
      { username: 'bob' },
    );
  });
});

describe('createSubgroup', () => {
  it('POST /api/groups/:name/subgroups with { name } and returns { name }', async () => {
    mock.post.mockResolvedValue({ data: { name: 'New Team' } });
    const result = await createSubgroup('Engineering', 'New Team');
    expect(mock.post).toHaveBeenCalledWith(
      '/api/groups/Engineering/subgroups',
      { name: 'New Team' },
    );
    expect(result).toEqual({ name: 'New Team' });
  });
});

describe('disbandGroup', () => {
  it('DELETE /api/groups/:name', async () => {
    mock.delete.mockResolvedValue({ data: { ok: true } });
    await disbandGroup('Engineering');
    expect(mock.delete).toHaveBeenCalledWith('/api/groups/Engineering');
  });
});

describe('setGroupColor', () => {
  it('PUT /api/groups/:name/color with { color }', async () => {
    mock.put.mockResolvedValue({ data: { ok: true } });
    await setGroupColor('Engineering', '#ff0000');
    expect(mock.put).toHaveBeenCalledWith(
      '/api/groups/Engineering/color',
      { color: '#ff0000' },
    );
  });
});

describe('detachChildGroup', () => {
  it('DELETE /api/groups/:parent/children/:child (both URL-encoded)', async () => {
    mock.delete.mockResolvedValue({ data: { ok: true } });
    await detachChildGroup('Parent Group', 'Child Group');
    expect(mock.delete).toHaveBeenCalledWith(
      '/api/groups/Parent%20Group/children/Child%20Group',
    );
  });
});
