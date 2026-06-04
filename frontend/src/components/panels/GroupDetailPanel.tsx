import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGroup,
  addMember,
  removeMember,
  addManager,
  removeManager,
  assignLeader,
  createSubgroup,
  addChildGroup,
  resignLeader,
  detachChildGroup,
  disbandGroup,
} from "../../api/groups";
import type { GroupRole, GroupMember, GroupChild } from "../../types";
import { searchUsers, type UserSummary } from "../../api/users";
import CrownIcon from "../CrownIcon";
import { useNavigate } from "react-router-dom";

interface GroupDetailPanelProps {
  groupPk: string;
  groupName: string;
  callerRole: GroupRole | "non-member";
  canAssignLeader: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Add Member Modal
// ---------------------------------------------------------------------------
interface AddMemberModalProps {
  groupPk: string;
  groupName: string;
  onClose: () => void;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({
  groupPk,
  groupName,
  onClose,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<UserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Debounced search
  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchUsers(searchTerm).then(setSearchResults).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const mutation = useMutation({
    mutationFn: (userPk: number) => addMember(groupName, userPk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to add member.";
      setLocalError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!selectedUser) {
      setLocalError("Please search for and select a user.");
      return;
    }
    mutation.mutate(selectedUser.pk);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Add Member
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Search by username or display name to find the user.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <label
              className="block text-xs font-medium text-gray-700 mb-1"
              htmlFor="userSearchInput"
            >
              Search user
            </label>
            {selectedUser ? (
              <div className="flex items-center gap-2 rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5">
                <span className="text-sm text-indigo-800 flex-1 min-w-0 truncate">
                  {selectedUser.name} ({selectedUser.username})
                </span>
                <button
                  type="button"
                  className="text-xs text-indigo-500 hover:text-indigo-700 shrink-0"
                  onClick={() => {
                    setSelectedUser(null);
                    setSearchTerm("");
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <>
                <input
                  id="userSearchInput"
                  type="text"
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="e.g. alice"
                  autoFocus
                />
                {searchResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((u) => (
                      <li
                        key={u.pk}
                        className="px-3 py-2 text-sm text-gray-800 cursor-pointer hover:bg-indigo-50"
                        onClick={() => {
                          setSelectedUser(u);
                          setSearchResults([]);
                          setSearchTerm("");
                        }}
                      >
                        {u.name} ({u.username})
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Create Subgroup Modal
// ---------------------------------------------------------------------------
interface CreateSubgroupModalProps {
  groupPk: string;
  groupName: string;
  onClose: () => void;
}

export const CreateSubgroupModal: React.FC<CreateSubgroupModalProps> = ({
  groupPk,
  groupName,
  onClose,
}) => {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (subgroupName: string) =>
      createSubgroup(groupName, subgroupName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to create subgroup.";
      setLocalError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError("Subgroup name is required.");
      return;
    }
    if (trimmed.length > 150) {
      setLocalError("Name must be 150 characters or fewer.");
      return;
    }
    mutation.mutate(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          Create Subgroup
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              className="block text-xs font-medium text-gray-700 mb-1"
              htmlFor="subgroupName"
            >
              Subgroup Name
            </label>
            <input
              id="subgroupName"
              type="text"
              maxLength={150}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Frontend Team"
              autoFocus
            />
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Add Child Group Modal
// ---------------------------------------------------------------------------
interface AddChildGroupModalProps {
  parentGroupPk: string;
  parentGroupName: string;
  onClose: () => void;
}

export const AddChildGroupModal: React.FC<AddChildGroupModalProps> = ({
  parentGroupPk,
  parentGroupName,
  onClose,
}) => {
  const [childName, setChildName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (name: string) => addChildGroup(parentGroupName, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      void queryClient.invalidateQueries({
        queryKey: ["group", parentGroupPk],
      });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to connect group.";
      setLocalError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const trimmed = childName.trim();
    if (!trimmed) {
      setLocalError("Group name is required.");
      return;
    }
    mutation.mutate(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          Connect Existing Group
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              className="block text-xs font-medium text-gray-700 mb-1"
              htmlFor="childGroupName"
            >
              Child Group Name
            </label>
            <input
              id="childGroupName"
              type="text"
              maxLength={150}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              placeholder="e.g. Backend Team"
              autoFocus
            />
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Resign Leader Modal
// ---------------------------------------------------------------------------
interface ResignLeaderModalProps {
  groupPk: string;
  groupName: string;
  members: GroupMember[];
  onClose: () => void;
}

export const ResignLeaderModal: React.FC<ResignLeaderModalProps> = ({
  groupPk,
  groupName,
  members,
  onClose,
}) => {
  const [selectedPk, setSelectedPk] = useState<number | "">("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (successorPk: number) => resignLeader(groupName, successorPk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to resign as leader.";
      setLocalError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (selectedPk === "") {
      setLocalError("Please select a successor.");
      return;
    }
    mutation.mutate(selectedPk);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Resign as Leader
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Choose a successor. They will become the new group leader.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              className="block text-xs font-medium text-gray-700 mb-1"
              htmlFor="successorSelect"
            >
              Successor
            </label>
            <select
              id="successorSelect"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              value={selectedPk}
              onChange={(e) =>
                setSelectedPk(
                  e.target.value === "" ? "" : parseInt(e.target.value, 10),
                )
              }
              disabled={members.length === 0}
            >
              <option value="">— Select a member —</option>
              {members.map((m) => (
                <option key={m.pk} value={m.pk}>
                  {m.name} (@{m.username})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="block text-xs font-medium text-gray-700 mb-1"
              htmlFor="resignConfirmInput"
            >
              Confirm resignation
            </label>
            <input
              id="resignConfirmInput"
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type the group name to confirm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Type &ldquo;{groupName}&rdquo; to confirm resignation.
            </p>
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          {members.length === 0 && (
            <p className="text-xs text-gray-400 italic">
              No eligible members to assign as successor.
            </p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
              disabled={
                mutation.isPending ||
                members.length === 0 ||
                confirmText !== groupName
              }
            >
              {mutation.isPending ? "Resigning…" : "Resign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Disband Group Modal
// ---------------------------------------------------------------------------
interface DisbandGroupModalProps {
  groupPk: string;
  groupName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const DisbandGroupModal: React.FC<DisbandGroupModalProps> = ({
  groupPk: _groupPk,
  groupName,
  onClose,
  onSuccess,
}) => {
  const [confirmText, setConfirmText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => disbandGroup(groupName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      onSuccess();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to disband group.";
      setLocalError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Disband group
        </h3>
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">
          This will permanently delete the group &ldquo;{groupName}&rdquo; and
          cannot be undone. All members will remain in the system but will lose
          their membership in this group.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type the group name to confirm"
              autoFocus
            />
          </div>
          {localError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {localError}
            </p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
              disabled={mutation.isPending || confirmText !== groupName}
            >
              {mutation.isPending ? "Disbanding…" : "Disband"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SubgroupRow
// ---------------------------------------------------------------------------
interface SubgroupRowProps {
  child: GroupChild;
  parentGroupName: string;
  parentGroupPk: string;
  canDetach: boolean;
  onClose: () => void;
}

const SubgroupRow: React.FC<SubgroupRowProps> = ({
  child,
  parentGroupName,
  parentGroupPk,
  canDetach,
  onClose,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const detachMutation = useMutation({
    mutationFn: () => detachChildGroup(parentGroupName, child.name),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["group", parentGroupPk],
      });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (err: unknown) => {
      setMutationError(
        err instanceof Error ? err.message : "Failed to detach subgroup.",
      );
    },
  });

  const handleDetach = () => {
    if (window.confirm(`Detach "${child.name}" from this group?`)) {
      setMutationError(null);
      detachMutation.mutate();
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded group">
        <span
          className="text-sm text-gray-800 cursor-pointer hover:underline flex-1 min-w-0 truncate"
          onClick={() => {
            navigate("/structure?focus=" + child.pk);
            onClose();
          }}
        >
          {child.name}
        </span>
        {canDetach && (
          <div
            className={`flex gap-1 ${detachMutation.isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
          >
            <button
              className="text-xs text-red-500 hover:text-red-700 px-1 disabled:opacity-50"
              onClick={handleDetach}
              disabled={detachMutation.isPending}
            >
              {detachMutation.isPending ? "…" : "Detach"}
            </button>
          </div>
        )}
      </div>
      {mutationError && (
        <p
          className="text-xs text-red-500 px-2 pb-1 cursor-pointer"
          onClick={() => setMutationError(null)}
          title="Click to dismiss"
        >
          {mutationError}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MemberRow
// ---------------------------------------------------------------------------
interface MemberRowProps {
  member: GroupMember;
  groupPk: string;
  groupName: string;
  callerRole: GroupRole | "non-member";
  canAssignLeader: boolean;
  isLeader?: boolean;
  isManager?: boolean;
}

const MemberRow: React.FC<MemberRowProps> = ({
  member,
  groupPk,
  groupName,
  callerRole,
  canAssignLeader,
  isLeader = false,
  isManager = false,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const onMutationError = (err: unknown) => {
    setMutationError(err instanceof Error ? err.message : "Operation failed.");
  };

  const removeMemberMutation = useMutation({
    mutationFn: () => removeMember(groupName, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: onMutationError,
  });

  const addManagerMutation = useMutation({
    mutationFn: () => addManager(groupName, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: onMutationError,
  });

  const removeManagerMutation = useMutation({
    mutationFn: () => removeManager(groupName, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: onMutationError,
  });

  const assignLeaderMutation = useMutation({
    mutationFn: () => assignLeader(groupName, member.pk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: onMutationError,
  });

  const handleRemoveMember = () => {
    if (window.confirm(`Remove ${member.name} from this group?`)) {
      setMutationError(null);
      removeMemberMutation.mutate();
    }
  };

  const handleAssignLeader = () => {
    if (
      window.confirm(
        `Assign ${member.name} as the new leader? You will become a regular member.`,
      )
    ) {
      setMutationError(null);
      assignLeaderMutation.mutate();
    }
  };

  const isBusy =
    removeMemberMutation.isPending ||
    addManagerMutation.isPending ||
    removeManagerMutation.isPending ||
    assignLeaderMutation.isPending;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded group">
        {isLeader && <CrownIcon variant="gold" size="sm" />}
        {isManager && !isLeader && <CrownIcon variant="silver" size="sm" />}
        <span
          className="text-sm text-gray-800 cursor-pointer hover:underline flex-1 min-w-0 truncate"
          onClick={() => navigate(`/users/${member.username}`)}
        >
          {member.name}
        </span>
        <span className="text-xs text-gray-400 hidden sm:inline truncate max-w-[100px]">
          {member.email}
        </span>

        {/* Action buttons — shown on hover, hidden when busy */}
        <div
          className={`flex gap-1 ${isBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
        >
          {/* Manager or leader: remove regular member */}
          {(callerRole === "manager" || callerRole === "leader") &&
            !isLeader &&
            !isManager && (
              <button
                className="text-xs text-red-500 hover:text-red-700 px-1 disabled:opacity-50"
                onClick={handleRemoveMember}
                disabled={isBusy}
              >
                {removeMemberMutation.isPending ? "…" : "Remove"}
              </button>
            )}

          {/* Leader only: promote regular member to manager */}
          {callerRole === "leader" && !isLeader && !isManager && (
            <button
              className="text-xs text-indigo-500 hover:text-indigo-700 px-1 disabled:opacity-50"
              onClick={() => {
                setMutationError(null);
                addManagerMutation.mutate();
              }}
              disabled={isBusy}
            >
              {addManagerMutation.isPending ? "…" : "Make manager"}
            </button>
          )}

          {/* Leader only: demote manager back to member */}
          {callerRole === "leader" && isManager && (
            <>
              <button
                className="text-xs text-red-500 hover:text-red-700 px-1 disabled:opacity-50"
                onClick={() => {
                  setMutationError(null);
                  removeManagerMutation.mutate();
                }}
                disabled={isBusy}
              >
                {removeManagerMutation.isPending ? "…" : "Remove manager"}
              </button>
              {canAssignLeader && (
                <button
                  className="text-xs text-yellow-600 hover:text-yellow-800 px-1 disabled:opacity-50"
                  onClick={handleAssignLeader}
                  disabled={isBusy}
                >
                  {assignLeaderMutation.isPending ? "…" : "Make leader"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {mutationError && (
        <p
          className="text-xs text-red-500 px-2 pb-1 cursor-pointer"
          onClick={() => setMutationError(null)}
          title="Click to dismiss"
        >
          {mutationError}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GroupDetailPanel
// ---------------------------------------------------------------------------
const GroupDetailPanel: React.FC<GroupDetailPanelProps> = ({
  groupPk,
  groupName,
  callerRole,
  canAssignLeader,
  onClose,
}) => {
  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateSubgroup, setShowCreateSubgroup] = useState(false);
  const [showAddChildGroup, setShowAddChildGroup] = useState(false);
  const [showResignLeader, setShowResignLeader] = useState(false);
  const [showDisband, setShowDisband] = useState(false);

  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["group", groupPk],
    queryFn: () => getGroup(groupName),
  });

  return (
    <>
      {showAddMember && (
        <AddMemberModal
          groupPk={groupPk}
          groupName={groupName}
          onClose={() => setShowAddMember(false)}
        />
      )}
      {showCreateSubgroup && (
        <CreateSubgroupModal
          groupPk={groupPk}
          groupName={groupName}
          onClose={() => setShowCreateSubgroup(false)}
        />
      )}
      {showAddChildGroup && (
        <AddChildGroupModal
          parentGroupPk={groupPk}
          parentGroupName={groupName}
          onClose={() => setShowAddChildGroup(false)}
        />
      )}
      {showResignLeader && detail && (
        <ResignLeaderModal
          groupPk={groupPk}
          groupName={groupName}
          members={[...(detail.managers ?? []), ...(detail.members ?? [])]}
          onClose={() => setShowResignLeader(false)}
        />
      )}
      {showDisband && (
        <DisbandGroupModal
          groupPk={groupPk}
          groupName={groupName}
          onClose={() => setShowDisband(false)}
          onSuccess={() => {
            setShowDisband(false);
            onClose();
          }}
        />
      )}

      <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 flex flex-col z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {detail?.name ?? "Group Detail"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close panel"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 rounded bg-gray-100 animate-pulse"
                />
              ))}
            </div>
          )}

          {isError && (
            <p className="text-red-500 text-sm">
              Failed to load group details.
            </p>
          )}

          {detail && (
            <>
              {/* Leader */}
              {detail.leader && (
                <section className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Leader
                  </p>
                  <MemberRow
                    member={detail.leader}
                    groupPk={groupPk}
                    groupName={groupName}
                    callerRole={callerRole}
                    canAssignLeader={canAssignLeader}
                    isLeader
                  />
                </section>
              )}

              {/* Managers */}
              {detail.managers.length > 0 && (
                <section className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Managers
                  </p>
                  {detail.managers.map((m) => (
                    <MemberRow
                      key={m.uuid}
                      member={m}
                      groupPk={groupPk}
                      groupName={groupName}
                      callerRole={callerRole}
                      canAssignLeader={canAssignLeader}
                      isManager
                    />
                  ))}
                </section>
              )}

              {/* Members */}
              <section className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Members
                  </p>
                  {(callerRole === "manager" || callerRole === "leader") && (
                    <button
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      onClick={() => setShowAddMember(true)}
                    >
                      + Add member
                    </button>
                  )}
                </div>
                {detail.members.length > 0 ? (
                  detail.members.map((m) => (
                    <MemberRow
                      key={m.uuid}
                      member={m}
                      groupPk={groupPk}
                      groupName={groupName}
                      callerRole={callerRole}
                      canAssignLeader={canAssignLeader}
                    />
                  ))
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    No regular members.
                  </p>
                )}
              </section>

              {/* Subgroups */}
              {(detail.children.length > 0 || callerRole === "leader") && (
                <section className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Subgroups
                  </p>
                  {detail.children.length > 0 ? (
                    detail.children.map((child) => (
                      <SubgroupRow
                        key={child.pk}
                        child={child}
                        parentGroupName={groupName}
                        parentGroupPk={groupPk}
                        canDetach={callerRole === "leader" && canAssignLeader}
                        onClose={onClose}
                      />
                    ))
                  ) : (
                    <p className="text-xs text-gray-400 italic">
                      No subgroups.
                    </p>
                  )}
                </section>
              )}

              {/* Leader-only actions */}
              {callerRole === "leader" && (
                <section className="space-y-2">
                  <button
                    className="w-full rounded border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
                    onClick={() => setShowCreateSubgroup(true)}
                  >
                    + Create subgroup
                  </button>

                  {canAssignLeader && (
                    <button
                      className="w-full rounded border border-dashed border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                      onClick={() => setShowAddChildGroup(true)}
                    >
                      + Connect existing group
                    </button>
                  )}

                  {canAssignLeader && (
                    <button
                      className="w-full rounded border border-dashed border-red-300 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      onClick={() => setShowResignLeader(true)}
                    >
                      Resign as leader
                    </button>
                  )}

                  {callerRole === "leader" && canAssignLeader && (
                    <button
                      className="w-full rounded border border-dashed border-red-400 py-2 text-sm text-red-700 hover:bg-red-50 transition-colors"
                      onClick={() => setShowDisband(true)}
                    >
                      Disband group
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default GroupDetailPanel;
