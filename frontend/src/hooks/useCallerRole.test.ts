import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCallerRole } from './useCallerRole';
import { makeUser, makeGroupDetail } from '../test/factories';

describe('useCallerRole', () => {
  it('returns non-member when detail is null', () => {
    const { result } = renderHook(() => useCallerRole(null, makeUser()));
    expect(result.current).toBe('non-member');
  });

  it('returns non-member when me is null', () => {
    const { result } = renderHook(() => useCallerRole(makeGroupDetail(), null));
    expect(result.current).toBe('non-member');
  });

  it('returns leader when the group name is in me.groups.leader', () => {
    const user = makeUser({ groups: { leader: [{ name: 'Engineering' }], manager: [], member: [] } });
    const detail = makeGroupDetail({ name: 'Engineering' });
    const { result } = renderHook(() => useCallerRole(detail, user));
    expect(result.current).toBe('leader');
  });

  it('returns manager when the group name is in me.groups.manager', () => {
    const user = makeUser({ groups: { leader: [], manager: [{ name: 'Engineering' }], member: [] } });
    const detail = makeGroupDetail({ name: 'Engineering' });
    const { result } = renderHook(() => useCallerRole(detail, user));
    expect(result.current).toBe('manager');
  });

  it('returns member when the group name is in me.groups.member', () => {
    const user = makeUser({ groups: { leader: [], manager: [], member: [{ name: 'Engineering' }] } });
    const detail = makeGroupDetail({ name: 'Engineering' });
    const { result } = renderHook(() => useCallerRole(detail, user));
    expect(result.current).toBe('member');
  });

  it('returns non-member when the group name does not appear in any bucket', () => {
    const user = makeUser({ groups: { leader: [{ name: 'Design' }], manager: [], member: [] } });
    const detail = makeGroupDetail({ name: 'Engineering' });
    const { result } = renderHook(() => useCallerRole(detail, user));
    expect(result.current).toBe('non-member');
  });

  it('leader takes precedence over manager if somehow in both', () => {
    const user = makeUser({
      groups: {
        leader: [{ name: 'Engineering' }],
        manager: [{ name: 'Engineering' }],
        member: [],
      },
    });
    const detail = makeGroupDetail({ name: 'Engineering' });
    const { result } = renderHook(() => useCallerRole(detail, user));
    expect(result.current).toBe('leader');
  });
});
