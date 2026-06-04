import apiClient from './client';
import type { GroupDetail, MutationSuccess } from '../types';

export async function getGroups(): Promise<GroupDetail[]> {
  const response = await apiClient.get<{ groups: GroupDetail[] }>('/api/groups', {
    params: { include_members: true },
  });
  return response.data.groups;
}

export async function getGroup(pk: string): Promise<GroupDetail> {
  const response = await apiClient.get<GroupDetail>(`/api/groups/${pk}`);
  return response.data;
}

export async function addMember(
  groupPk: string,
  userPk: number,
): Promise<MutationSuccess> {
  const response = await apiClient.post<MutationSuccess>(
    `/api/groups/${groupPk}/members`,
    { user_pk: userPk },
  );
  return response.data;
}

export async function removeMember(
  groupPk: string,
  userPk: number,
): Promise<MutationSuccess> {
  const response = await apiClient.delete<MutationSuccess>(
    `/api/groups/${groupPk}/members/${userPk}`,
  );
  return response.data;
}

export async function addManager(
  groupPk: string,
  userPk: number,
): Promise<MutationSuccess> {
  const response = await apiClient.post<MutationSuccess>(
    `/api/groups/${groupPk}/managers`,
    { user_pk: userPk },
  );
  return response.data;
}

export async function removeManager(
  groupPk: string,
  userPk: number,
): Promise<MutationSuccess> {
  const response = await apiClient.delete<MutationSuccess>(
    `/api/groups/${groupPk}/managers/${userPk}`,
  );
  return response.data;
}

export async function assignLeader(
  groupPk: string,
  userPk: number,
): Promise<MutationSuccess> {
  const response = await apiClient.put<MutationSuccess>(
    `/api/groups/${groupPk}/leader`,
    { user_pk: userPk },
  );
  return response.data;
}

export async function createSubgroup(
  groupPk: string,
  name: string,
): Promise<{ pk: string; name: string; leader_uuid: string }> {
  const response = await apiClient.post<{
    pk: string;
    name: string;
    leader_uuid: string;
  }>(`/api/groups/${groupPk}/subgroups`, { name });
  return response.data;
}
