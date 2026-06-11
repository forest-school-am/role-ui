import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGroup,
  getGroups,
  removeMember,
  removeManager,
  removeLeader,
  addManager,
  addLeader,
  renameGroup,
} from "../../api/groups";
import { extractApiError } from "../../api/client";
import { invalidateGroup } from "../../api/groupQueryHelpers";
import { getMe } from "../../api/users";
import ColorPicker from "../dag/ColorPicker";
import PageLoadingSkeleton from "../ui/PageLoadingSkeleton";
import PageErrorCard from "../ui/PageErrorCard";
import DashedButton from "../ui/DashedButton";
import MutationErrorBanner from "../ui/MutationErrorBanner";
import EmptyNote from "../ui/EmptyNote";
import Section from "../ui/Section";
import EditButton from "../ui/EditButton";
import GroupModalsRenderer from "../panels/GroupModalsRenderer";
import UserRow from "../user/UserRow";
import GroupRow from "./GroupRow";
import GoogleSyncSection from "./GoogleSyncSection";
import { useCallerRole } from "../../hooks/useCallerRole";
import { useGroupModals } from "../../hooks/useGroupModals";
import { useSuperuser } from "../../auth/SuperuserContext";
import { MINI_LINK_BTN_CLS } from "../../lib/ui-constants";

interface GroupPageProps {
  groupName: string;
}

const GroupPage: React.FC<GroupPageProps> = ({ groupName }) => {
  const navigate = useNavigate();
  const { activeModal, open, close } = useGroupModals();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isRenamingGroup, setIsRenamingGroup] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const {
    data: detail,
    isLoading: detailLoading,
    isError: detailError,
    error: detailErrorObj,
  } = useQuery({
    queryKey: ["group", groupName],
    queryFn: () => getGroup(groupName),
    enabled: !!groupName,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });

  const { data: allGroups } = useQuery({ queryKey: ["groups"], queryFn: getGroups });

  const callerRole = useCallerRole(detail, me);
  const { superuserModeActive } = useSuperuser();
  const effectiveIsLeader = callerRole === 'leader' || superuserModeActive;

  const removeMemberMutation = useMutation({
    mutationFn: ({ username }: { username: string }) =>
      removeMember(groupName, username),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const removeManagerMutation = useMutation({
    mutationFn: ({ username }: { username: string }) =>
      removeManager(groupName, username),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const addManagerMutation = useMutation({
    mutationFn: ({ username }: { username: string }) =>
      addManager(groupName, username),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const addLeaderMutation = useMutation({
    mutationFn: ({ username }: { username: string }) =>
      addLeader(groupName, username),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const removeLeaderMutation = useMutation({
    mutationFn: ({ username }: { username: string }) =>
      removeLeader(groupName, username),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => renameGroup(groupName, name),
    onSuccess: (_, newName) => {
      setIsRenamingGroup(false);
      setRenameError(null);
      void queryClient.refetchQueries({ queryKey: ['groups'] });
      navigate(`/groups/${encodeURIComponent(newName)}`, { replace: true });
    },
    onError: (err) => setRenameError(extractApiError(err)),
  });

  function startRename() {
    setRenameValue(detail?.name ?? '');
    setRenameError(null);
    setIsRenamingGroup(true);
  }

  if (detailLoading) return <PageLoadingSkeleton />;

  if (detailError) {
    const message =
      detailErrorObj instanceof Error ? detailErrorObj.message : "Failed to load group.";
    const isNotFound = message.toLowerCase().includes("not found");
    return (
      <PageErrorCard
        title={isNotFound ? "Group not found" : "Error"}
        message={message}
      />
    );
  }

  if (!detail) return null;

  const resolvedGroups = allGroups ?? [];
  const canManage = effectiveIsLeader || callerRole === "manager";

  const leaders = detail.members.leader;
  const managers = detail.members.manager;
  const members = detail.members.member;

  return (
    <>
      <GroupModalsRenderer
        groupName={detail.name}
        detail={detail}
        activeModal={activeModal}
        close={close}
        onDisbandSuccess={() => navigate("/structure")}
      />

      <div className="max-w-5xl mx-auto p-8">
        <MutationErrorBanner message={mutationError} />

        <div className="flex flex-col md:flex-row gap-8 mt-2">
          {/* Left — identity */}
          <div className="flex-none w-full md:w-64 space-y-6">
            {isRenamingGroup ? (
              <div className="space-y-1">
                <input
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameMutation.mutate(renameValue);
                    if (e.key === 'Escape') setIsRenamingGroup(false);
                  }}
                />
                {renameError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                    {renameError}
                  </p>
                )}
                <div className="flex gap-2 justify-end pt-0.5">
                  <button
                    type="button"
                    onClick={() => setIsRenamingGroup(false)}
                    disabled={renameMutation.isPending}
                    className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => renameMutation.mutate(renameValue)}
                    disabled={renameMutation.isPending}
                    className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {renameMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <h1 className="text-2xl font-bold text-gray-900">{detail.name}</h1>
                {effectiveIsLeader && (
                  <EditButton onClick={startRename} className="mt-1.5" />
                )}
              </div>
            )}

            <button
              className="flex items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 transition-colors"
              onClick={() =>
                navigate(`/structure?focus=${encodeURIComponent(detail.name)}`)
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="5" r="3" />
                <circle cx="19" cy="19" r="3" />
                <circle cx="5" cy="19" r="3" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="12" x2="19" y2="16" />
                <line x1="12" y1="12" x2="5" y2="16" />
              </svg>
              View in graph
            </button>

            {/* Parent groups */}
            {detail.parents.length > 0 && (
              <Section title="Parent Groups">
                <div className="space-y-1">
                  {detail.parents.map((parent) => (
                    <span
                      key={parent.name}
                      className="block text-sm text-indigo-600 hover:underline cursor-pointer"
                      onClick={() => navigate("/groups/" + encodeURIComponent(parent.name))}
                    >
                      {parent.name}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Peer groups (siblings via shared parent) */}
            {detail.parents.length > 0 && (() => {
              const siblings = resolvedGroups.filter(
                (g) =>
                  g.name !== detail.name &&
                  g.parents.some((p) =>
                    detail.parents.some((dp) => dp.name === p.name),
                  ),
              );
              if (siblings.length === 0) return null;
              return (
                <Section title="Peer Groups">
                  <div className="space-y-1">
                    {siblings.slice(0, 5).map((g) => (
                      <span
                        key={g.name}
                        className="block text-sm text-indigo-600 hover:underline cursor-pointer"
                        onClick={() => navigate("/groups/" + encodeURIComponent(g.name))}
                      >
                        {g.name}
                      </span>
                    ))}
                  </div>
                </Section>
              );
            })()}

            {/* Stats */}
            <Section title="Stats">
              <div className="space-y-1 text-sm text-gray-700">
                <p>
                  <span className="font-medium">{managers.length}</span>{" "}
                  manager{managers.length !== 1 ? "s" : ""}
                </p>
                <p>
                  <span className="font-medium">{members.length}</span>{" "}
                  member{members.length !== 1 ? "s" : ""}
                </p>
                <p>
                  <span className="font-medium">{detail.children.length}</span>{" "}
                  subgroup{detail.children.length !== 1 ? "s" : ""}
                </p>
              </div>
            </Section>

            {/* Google Sync */}
            <GoogleSyncSection
              groupName={detail.name}
              googleSync={detail.google_sync}
              canEdit={effectiveIsLeader}
            />

            {/* Group colour */}
            {effectiveIsLeader && (
              <Section title="Group colour">
                <ColorPicker
                  currentColor={detail.color}
                  groupName={detail.name}
                  onColorChange={() =>
                    void queryClient.invalidateQueries({ queryKey: ["group", detail.name] })
                  }
                />
              </Section>
            )}

            {/* Action buttons */}
            {effectiveIsLeader && (
              <div className="space-y-2">
                {callerRole === "leader" && (
                  <DashedButton color="red" onClick={() => open("resignLeader")}>
                    Resign as leader
                  </DashedButton>
                )}
                <DashedButton color="red" variant="dark" onClick={() => open("disband")}>
                  Disband group
                </DashedButton>
              </div>
            )}
          </div>

          {/* Right — roster */}
          <div className="flex-1 space-y-6">
            {/* Leader */}
            <Section title="Leader">
              {leaders.length > 0 ? (
                <div className="space-y-1">
                  {leaders.map((l) => (
                    <UserRow
                      key={l.username}
                      member={l}
                      crownVariant="gold"
                      onUserClick={(u) => navigate(`/users/${u}`)}
                      actions={
                        superuserModeActive ? (
                          <button
                            className="text-xs text-orange-500 hover:text-orange-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removeLeaderMutation.mutate({ username: l.username })}
                            disabled={removeLeaderMutation.isPending}
                          >
                            {removeLeaderMutation.isPending ? "…" : "← Member"}
                          </button>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyNote>No leader</EmptyNote>
              )}
            </Section>

            {/* Managers */}
            {managers.length > 0 && (
              <Section title="Managers">
                <div className="space-y-1">
                  {managers.map((m) => (
                    <UserRow
                      key={m.username}
                      member={m}
                      crownVariant="silver"
                      onUserClick={(u) => navigate(`/users/${u}`)}
                      actions={
                        effectiveIsLeader ? (
                          <>
                            {superuserModeActive && (
                              <button
                                className="text-xs text-yellow-600 hover:text-yellow-800 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => addLeaderMutation.mutate({ username: m.username })}
                                disabled={addLeaderMutation.isPending}
                              >
                                {addLeaderMutation.isPending ? "…" : "→ Leader"}
                              </button>
                            )}
                            <button
                              className="text-xs text-orange-500 hover:text-orange-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => removeManagerMutation.mutate({ username: m.username })}
                              disabled={removeManagerMutation.isPending}
                            >
                              {removeManagerMutation.isPending ? "…" : "← Member"}
                            </button>
                          </>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* Members */}
            <Section
              title="Members"
              actions={
                canManage ? (
                  <button
                    className={`${MINI_LINK_BTN_CLS} font-medium`}
                    onClick={() => open("addMember")}
                  >
                    + Add member
                  </button>
                ) : undefined
              }
            >
              {members.length > 0 ? (
                <div className="space-y-1">
                  {members.map((m) => (
                    <UserRow
                      key={m.username}
                      member={m}
                      onUserClick={(u) => navigate(`/users/${u}`)}
                      actions={
                        <>
                          {superuserModeActive && (
                            <button
                              className="text-xs text-yellow-600 hover:text-yellow-800 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => addLeaderMutation.mutate({ username: m.username })}
                              disabled={addLeaderMutation.isPending}
                            >
                              {addLeaderMutation.isPending ? "…" : "→ Leader"}
                            </button>
                          )}
                          {effectiveIsLeader && (
                            <button
                              className="text-xs text-indigo-500 hover:text-indigo-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() =>
                                addManagerMutation.mutate({ username: m.username })
                              }
                              disabled={addManagerMutation.isPending}
                            >
                              {addManagerMutation.isPending ? "…" : "→ Manager"}
                            </button>
                          )}
                          {canManage && (
                            <button
                              className="text-xs text-red-500 hover:text-red-700 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() =>
                                removeMemberMutation.mutate({ username: m.username })
                              }
                              disabled={removeMemberMutation.isPending}
                            >
                              Remove
                            </button>
                          )}
                        </>
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyNote>No regular members.</EmptyNote>
              )}
            </Section>

            {/* Subgroups */}
            <Section title="Subgroups">
              {detail.children.length > 0 ? (
                <div className="space-y-1">
                  {detail.children.map((child) => (
                    <GroupRow
                      key={child.name}
                      child={child}
                      parentGroupName={groupName}
                      canDetach={superuserModeActive}
                    />
                  ))}
                </div>
              ) : (
                <EmptyNote>No subgroups.</EmptyNote>
              )}

              {effectiveIsLeader && (
                <div className="mt-3 space-y-2">
                  <DashedButton color="indigo" onClick={() => open("createSubgroup")}>
                    + Create subgroup
                  </DashedButton>
                  {superuserModeActive && (
                    <DashedButton color="gray" onClick={() => open("addChildGroup")}>
                      + Connect existing group
                    </DashedButton>
                  )}
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </>
  );
};

export default GroupPage;
