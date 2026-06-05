import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGroup,
  removeMember,
  removeManager,
  detachChildGroup,
} from "../../api/groups";
import { extractApiError } from "../../api/client";
import { invalidateGroup } from "../../api/groupQueryHelpers";
import { getMe } from "../../api/users";
import type { GroupMember, GroupChild } from "../../types";
import ColorPicker from "../dag/ColorPicker";
import CrownIcon from "../CrownIcon";
import GroupModalsRenderer from "./GroupModalsRenderer";
import OverflowHint from "../ui/OverflowHint";
import EmptyNote from "../ui/EmptyNote";
import DashedButton from "../ui/DashedButton";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useCallerRole } from "../../hooks/useCallerRole";
import { useGroupModals } from "../../hooks/useGroupModals";
import { SECTION_LABEL_CLS, MINI_LINK_BTN_CLS } from "../../lib/ui-constants";

interface GroupPreviewPanelProps {
  groupPk: string;
  groupName: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// MemberRow — compact, local component
// ---------------------------------------------------------------------------
function MemberRow({
  member,
  role,
  groupName,
  groupPk,
  callerRole,
}: {
  member: GroupMember;
  role: "leader" | "manager" | "member";
  groupName: string;
  groupPk: string;
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
      invalidateGroup(queryClient, groupPk);
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  const canRemove =
    role !== "leader" &&
    (callerRole === "leader" ||
      (callerRole === "manager" && role === "member"));

  return (
    <>
      <div className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-gray-50 group">
        <span className="w-4 flex-none flex items-center">
          {role === "leader" && <CrownIcon variant="gold" size="sm" />}
          {role === "manager" && <CrownIcon variant="silver" size="sm" />}
        </span>
        <span
          className="text-xs text-gray-800 flex-1 truncate cursor-pointer hover:text-indigo-600"
          onClick={() => navigate(`/users/${member.username}`)}
          title={member.name}
        >
          {member.name}
        </span>
        {canRemove && (
          <button
            className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
          >
            ×
          </button>
        )}
      </div>
      {mutationError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mx-3 mb-2">
          {mutationError}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// SubgroupRowItem — hover-reveal detach button for subgroup rows
// ---------------------------------------------------------------------------
function SubgroupRowItem({
  child,
  parentGroupName,
  parentGroupPk,
  canDetach,
}: {
  child: GroupChild;
  parentGroupName: string;
  parentGroupPk: string;
  canDetach: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const detachMutation = useMutation({
    mutationFn: () => detachChildGroup(parentGroupName, child.name),
    onSuccess: () => {
      setMutationError(null);
      invalidateGroup(queryClient, parentGroupPk);
    },
    onError: (err) => setMutationError(extractApiError(err)),
  });

  return (
    <>
      <div className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-gray-50 group">
        <span className="w-4 flex-none" />
        <span
          className="text-xs text-gray-800 flex-1 truncate cursor-pointer hover:text-indigo-600"
          onClick={() => navigate(`/groups/${encodeURIComponent(child.name)}`)}
        >
          {child.name}
        </span>
        {canDetach && (
          <button
            className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
            onClick={() => {
              if (window.confirm(`Detach "${child.name}" from this group?`)) {
                detachMutation.mutate();
              }
            }}
            disabled={detachMutation.isPending}
            title="Detach subgroup"
          >
            {detachMutation.isPending ? "…" : "×"}
          </button>
        )}
      </div>
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
  groupPk,
  groupName,
  onClose,
}) => {
  const isVirtual = groupPk.startsWith("virtual:");

  const {
    data: detail,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["group", groupPk],
    queryFn: () => getGroup(groupName),
    enabled: !isVirtual,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });

  const queryClient = useQueryClient();

  const callerRole = useCallerRole(detail, me);

  const { activeModal, open, close } = useGroupModals();

  useEscapeKey(onClose);

  return (
    <>
      <div className="fixed right-0 top-0 h-full w-72 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
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
          {/* Loading / error states */}
          {isLoading && (
            <div className="px-4 py-3 space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-6 rounded bg-gray-100 animate-pulse"
                />
              ))}
            </div>
          )}

          {isError && (
            <div className="px-4 py-3">
              <p className="text-red-500 text-sm">
                {error instanceof Error
                  ? error.message
                  : "Failed to load group."}
              </p>
            </div>
          )}

          {/* Stats section */}
          {detail && (
            <div className="px-4 py-3">
              <div>
                <p className={`${SECTION_LABEL_CLS} mb-1`}>Leader</p>
                {detail.leader ? (
                  <Link
                    to={`/users/${detail.leader.username}`}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    {detail.leader.name}
                  </Link>
                ) : (
                  <EmptyNote>No leader</EmptyNote>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center mt-3">
                <div className="rounded bg-gray-50 p-2">
                  <p className="text-lg font-bold text-gray-900">
                    {detail.managers.length}
                  </p>
                  <p className="text-xs text-gray-500">Managers</p>
                </div>
                <div className="rounded bg-gray-50 p-2">
                  <p className="text-lg font-bold text-gray-900">
                    {detail.members.length}
                  </p>
                  <p className="text-xs text-gray-500">Members</p>
                </div>
                <div className="rounded bg-gray-50 p-2">
                  <p className="text-lg font-bold text-gray-900">
                    {detail.children.length}
                  </p>
                  <p className="text-xs text-gray-500">Subgroups</p>
                </div>
              </div>
            </div>
          )}

          {/* Members section */}
          {detail && (
            <section className="px-4 py-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <span className={SECTION_LABEL_CLS}>Members</span>
                {!isVirtual &&
                  (callerRole === "leader" || callerRole === "manager") && (
                    <button
                      className={MINI_LINK_BTN_CLS}
                      onClick={() => open("addMember")}
                    >
                      + Add
                    </button>
                  )}
              </div>
              {/* Leader row */}
              {detail.leader && (
                <MemberRow
                  member={detail.leader}
                  role="leader"
                  groupName={groupName}
                  groupPk={groupPk}
                  callerRole={callerRole}
                />
              )}
              {/* Managers */}
              {detail.managers.slice(0, 5).map((m) => (
                <MemberRow
                  key={m.pk}
                  member={m}
                  role="manager"
                  groupName={groupName}
                  groupPk={groupPk}
                  callerRole={callerRole}
                />
              ))}
              {/* Members */}
              {detail.members
                .slice(0, Math.max(0, 5 - detail.managers.length))
                .map((m) => (
                  <MemberRow
                    key={m.pk}
                    member={m}
                    role="member"
                    groupName={groupName}
                    groupPk={groupPk}
                    callerRole={callerRole}
                  />
                ))}
              {/* Overflow count */}
              <OverflowHint
                count={detail.managers.length + detail.members.length - 5}
                groupName={groupName}
              />
            </section>
          )}

          {/* Subgroups section */}
          {detail && (
            <section className="px-4 py-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <span className={SECTION_LABEL_CLS}>Subgroups</span>
                {!isVirtual && callerRole === "leader" && (
                  <div className="flex gap-1">
                    <button
                      className={MINI_LINK_BTN_CLS}
                      onClick={() => open("createSubgroup")}
                    >
                      + New
                    </button>
                    <span className="text-xs text-gray-300">|</span>
                    <button
                      className={MINI_LINK_BTN_CLS}
                      onClick={() => open("addChildGroup")}
                    >
                      + Attach
                    </button>
                  </div>
                )}
              </div>
              {detail.children.length === 0 ? (
                <EmptyNote>No subgroups</EmptyNote>
              ) : (
                <>
                  {detail.children.slice(0, 5).map((child) => (
                    <SubgroupRowItem
                      key={child.pk}
                      child={child}
                      parentGroupName={groupName}
                      parentGroupPk={groupPk}
                      canDetach={callerRole === "leader"}
                    />
                  ))}
                  <OverflowHint
                    count={detail.children.length - 5}
                    groupName={groupName}
                  />
                </>
              )}
            </section>
          )}

          {/* Group colour section */}
          {!isVirtual && callerRole === "leader" && detail && (
            <section className="px-4 py-2 border-t border-gray-100">
              <p className={`${SECTION_LABEL_CLS} mb-2`}>Group colour</p>
              <ColorPicker
                currentColor={detail.color}
                groupName={groupName}
                groupPk={groupPk}
                onColorChange={() =>
                  void queryClient.invalidateQueries({
                    queryKey: ["group", groupPk],
                  })
                }
              />
            </section>
          )}

          {/* Leader actions section */}
          {!isVirtual && callerRole === "leader" && (
            <section className="px-4 py-2 border-t border-gray-100 flex flex-col gap-1">
              <DashedButton
                color="red"
                size="xs"
                onClick={() => open("resignLeader")}
              >
                Resign as leader
              </DashedButton>
              <DashedButton
                color="red"
                variant="dark"
                size="xs"
                onClick={() => open("disband")}
              >
                Disband group
              </DashedButton>
            </section>
          )}
        </div>
      </div>

      {/* Modals */}
      <GroupModalsRenderer
        groupPk={groupPk}
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
