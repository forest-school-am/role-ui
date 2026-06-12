import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGroup,
  removeMember,
  removeManager,
} from "../../api/groups";
import { extractApiError } from "../../api/client";
import { invalidateGroup } from "../../api/groupQueryHelpers";
import { getMe } from "../../api/users";
import type { UserLink } from "../../types";
import ColorPicker from "../dag/ColorPicker";
import GroupModalsRenderer from "./GroupModalsRenderer";
import UserRow from "../user/UserRow";
import GroupRow from "../group/GroupRow";
import OverflowHint from "../ui/OverflowHint";
import EmptyNote from "../ui/EmptyNote";
import DashedButton from "../ui/DashedButton";
import Section from "../ui/Section";
import GoogleSyncSection from "../group/GoogleSyncSection";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useCallerRole } from "../../hooks/useCallerRole";
import { useGroupModals } from "../../hooks/useGroupModals";
import { useSuperuser } from "../../auth/SuperuserContext";
import { MINI_LINK_BTN_CLS } from "../../lib/ui-constants";

const PANEL_SECTION_CLS = "px-4 py-2 border-t border-gray-100";

interface GroupPreviewPanelProps {
  groupName: string;
  isVirtual?: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// MemberRow
// ---------------------------------------------------------------------------
function MemberRow({
  member,
  role,
  groupName,
  callerRole,
}: {
  member: UserLink;
  role: "leader" | "manager" | "member";
  groupName: string;
  callerRole: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const removeMutation = useMutation({
    mutationFn: () =>
      role === "manager"
        ? removeManager(groupName, member.username)
        : removeMember(groupName, member.username),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, groupName);
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const canRemove =
    role !== "leader" &&
    (callerRole === "leader" ||
      (callerRole === "manager" && role === "member"));

  const crownVariant =
    role === "leader" ? "gold" : role === "manager" ? "silver" : undefined;

  return (
    <>
      <UserRow
        member={member}
        crownVariant={crownVariant}
        onUserClick={(u) => navigate(`/users/${u}`)}
        actions={
          canRemove ? (
            <button
              className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
            >
              ×
            </button>
          ) : undefined
        }
      />
      {mutationError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mx-3 mb-2">
          {mutationError}
        </p>
      )}
    </>
  );
}


// ---------------------------------------------------------------------------
// GroupPreviewPanel
// ---------------------------------------------------------------------------
const GroupPreviewPanel: React.FC<GroupPreviewPanelProps> = ({
  groupName,
  isVirtual,
  onClose,
}) => {
  const {
    data: detail,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["group", groupName],
    queryFn: () => getGroup(groupName),
    enabled: !isVirtual,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const queryClient = useQueryClient();
  const callerRole = useCallerRole(detail, me);
  const { superuserModeActive } = useSuperuser();
  const effectiveIsLeader = callerRole === "leader" || superuserModeActive;
  const effectiveCallerRole = effectiveIsLeader ? "leader" : callerRole;
  const { activeModal, open, close } = useGroupModals();

  useEscapeKey(onClose);

  const managers = detail?.members.manager ?? [];
  const members = detail?.members.member ?? [];

  return (
    <>
      <div className="fixed right-0 top-12 h-[calc(100vh-3rem)] w-72 bg-white shadow-2xl border-l border-gray-200 z-40 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-none">
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">
              {groupName}
            </h2>
            {!isVirtual && (
              <Link
                to={`/groups/${encodeURIComponent(groupName)}`}
                className="flex-none text-gray-400 hover:text-indigo-600 transition-colors"
                title="Open group page"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </Link>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-2 flex-none"
            aria-label="Close panel"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="px-4 py-3 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 rounded bg-gray-100 animate-pulse" />
              ))}
            </div>
          )}

          {isError && (
            <div className="px-4 py-3">
              <p className="text-red-500 text-sm">
                {error instanceof Error ? error.message : "Failed to load group."}
              </p>
            </div>
          )}

          {detail && (
            <div className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-gray-50 p-2">
                  <p className="text-lg font-bold text-gray-900">{managers.length}</p>
                  <p className="text-xs text-gray-500">Managers</p>
                </div>
                <div className="rounded bg-gray-50 p-2">
                  <p className="text-lg font-bold text-gray-900">{members.length}</p>
                  <p className="text-xs text-gray-500">Members</p>
                </div>
                <div className="rounded bg-gray-50 p-2">
                  <p className="text-lg font-bold text-gray-900">{detail.children.length}</p>
                  <p className="text-xs text-gray-500">Subgroups</p>
                </div>
              </div>
            </div>
          )}

          {/* Members section */}
          {detail && (
            <Section
              title="Members"
              className={PANEL_SECTION_CLS}
              actions={
                !isVirtual && (effectiveIsLeader || callerRole === "manager") ? (
                  <button className={MINI_LINK_BTN_CLS} onClick={() => open("addMember")}>
                    + Add
                  </button>
                ) : undefined
              }
            >
              {[...(detail?.members.leader ?? [])].sort((a, b) => a.username.localeCompare(b.username)).map((l) => (
                <MemberRow
                  key={l.username}
                  member={l}
                  role="leader"
                  groupName={groupName}
                  callerRole={effectiveCallerRole}
                />
              ))}
              {[...managers].sort((a, b) => a.username.localeCompare(b.username)).slice(0, 5).map((m) => (
                <MemberRow
                  key={m.username}
                  member={m}
                  role="manager"
                  groupName={groupName}
                  callerRole={effectiveCallerRole}
                />
              ))}
              {[...members]
                .sort((a, b) => a.username.localeCompare(b.username))
                .slice(0, Math.max(0, 5 - managers.length))
                .map((m) => (
                  <MemberRow
                    key={m.username}
                    member={m}
                    role="member"
                    groupName={groupName}
                    callerRole={effectiveCallerRole}
                  />
                ))}
              <OverflowHint
                count={managers.length + members.length - 5}
                groupName={groupName}
              />
            </Section>
          )}

          {/* Subgroups section */}
          {detail && (
            <Section
              title="Subgroups"
              className={PANEL_SECTION_CLS}
              actions={
                !isVirtual && effectiveIsLeader ? (
                  <div className="flex gap-1">
                    <button className={MINI_LINK_BTN_CLS} onClick={() => open("createSubgroup")}>
                      + New
                    </button>
                    {superuserModeActive && (
                      <>
                        <span className="text-xs text-gray-300">|</span>
                        <button className={MINI_LINK_BTN_CLS} onClick={() => open("addChildGroup")}>
                          + Attach
                        </button>
                      </>
                    )}
                  </div>
                ) : undefined
              }
            >
              {detail.children.length === 0 ? (
                <EmptyNote>No subgroups</EmptyNote>
              ) : (
                <>
                  {[...detail.children].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 5).map((child) => (
                    <GroupRow
                      key={child.name}
                      child={child}
                      parentGroupName={groupName}
                      canDetach={superuserModeActive}
                    />
                  ))}
                  <OverflowHint count={detail.children.length - 5} groupName={groupName} />
                </>
              )}
            </Section>
          )}

          {/* Google Sync section */}
          {detail && (
            <GoogleSyncSection
              groupName={groupName}
              googleSync={detail.google_sync}
              canEdit={!isVirtual && effectiveIsLeader}
              className={PANEL_SECTION_CLS}
            />
          )}

          {/* Group colour section */}
          {!isVirtual && effectiveIsLeader && detail && (
            <Section title="Group colour" className={PANEL_SECTION_CLS}>
              <ColorPicker
                currentColor={detail.color}
                groupName={groupName}
                onColorChange={() =>
                  void queryClient.invalidateQueries({ queryKey: ["group", groupName] })
                }
              />
            </Section>
          )}

          {/* Leader actions section */}
          {!isVirtual && effectiveIsLeader && (
            <section className={`${PANEL_SECTION_CLS} flex flex-col gap-1`}>
              {callerRole === "leader" && (
                <DashedButton color="red" size="xs" onClick={() => open("resignLeader")}>
                  Resign as leader
                </DashedButton>
              )}
              <DashedButton color="red" variant="dark" size="xs" onClick={() => open("disband")}>
                Disband group
              </DashedButton>
            </section>
          )}
        </div>
      </div>

      <GroupModalsRenderer
        groupName={groupName}
        detail={detail}
        activeModal={activeModal}
        close={close}
        onDisbandSuccess={onClose}
      />
    </>
  );
};

export default GroupPreviewPanel;
