import apiClient from "./client";
import type { GroupDetail, MutationSuccess } from "../types";

export async function getGroups(): Promise<GroupDetail[]> {
  const response = await apiClient.get<GroupDetail[]>("/api/groups");
  return response.data;
}

export async function getGroup(groupName: string): Promise<GroupDetail> {
  const response = await apiClient.get<GroupDetail>(
    `/api/groups/${encodeURIComponent(groupName)}`,
  );
  return response.data;
}

export async function addMember(
  groupName: string,
  username: string,
): Promise<MutationSuccess> {
  const response = await apiClient.post<MutationSuccess>(
    `/api/groups/${encodeURIComponent(groupName)}/members`,
    { username },
  );
  return response.data;
}

export async function removeMember(
  groupName: string,
  username: string,
): Promise<MutationSuccess> {
  const response = await apiClient.delete<MutationSuccess>(
    `/api/groups/${encodeURIComponent(groupName)}/members/${encodeURIComponent(username)}`,
  );
  return response.data;
}

export async function addManager(
  groupName: string,
  username: string,
): Promise<MutationSuccess> {
  const response = await apiClient.post<MutationSuccess>(
    `/api/groups/${encodeURIComponent(groupName)}/managers`,
    { username },
  );
  return response.data;
}

export async function removeManager(
  groupName: string,
  username: string,
): Promise<MutationSuccess> {
  const response = await apiClient.delete<MutationSuccess>(
    `/api/groups/${encodeURIComponent(groupName)}/managers/${encodeURIComponent(username)}`,
  );
  return response.data;
}

export async function createSubgroup(
  groupName: string,
  name: string,
): Promise<{ name: string }> {
  const response = await apiClient.post<{ name: string }>(
    `/api/groups/${encodeURIComponent(groupName)}/subgroups`,
    { name },
  );
  return response.data;
}

export async function addChildGroup(
  parentGroupName: string,
  childGroupName: string,
): Promise<MutationSuccess> {
  const { data } = await apiClient.post<MutationSuccess>(
    `/api/groups/${encodeURIComponent(parentGroupName)}/children`,
    { group_name: childGroupName },
  );
  return data;
}

export async function resignLeader(
  groupName: string,
  successorUsername: string,
): Promise<MutationSuccess> {
  const { data } = await apiClient.post<MutationSuccess>(
    `/api/groups/${encodeURIComponent(groupName)}/leader/resign`,
    { username: successorUsername },
  );
  return data;
}

export async function detachChildGroup(
  parentGroupName: string,
  childGroupName: string,
): Promise<MutationSuccess> {
  const { data } = await apiClient.delete<MutationSuccess>(
    `/api/groups/${encodeURIComponent(parentGroupName)}/children/${encodeURIComponent(childGroupName)}`,
  );
  return data;
}

export async function disbandGroup(
  groupName: string,
): Promise<MutationSuccess> {
  const { data } = await apiClient.delete<MutationSuccess>(
    `/api/groups/${encodeURIComponent(groupName)}`,
  );
  return data;
}

export async function setGroupColor(
  groupName: string,
  color: string,
): Promise<MutationSuccess> {
  const { data } = await apiClient.put<MutationSuccess>(
    `/api/groups/${encodeURIComponent(groupName)}/color`,
    { color },
  );
  return data;
}
