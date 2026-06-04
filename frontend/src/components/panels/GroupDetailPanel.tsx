import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
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
import { extractApiError } from "../../api/client";
import type { GroupRole, GroupMember, GroupChild } from "../../types";
import { searchUsers, type UserSummary } from "../../api/users";
import CrownIcon from "../CrownIcon";
import { useNavigate } from "react-router-dom";
import ModalShell from "../ui/ModalShell";
import ModalActions from "../ui/ModalActions";
import { useDebounce } from "../../hooks/useDebounce";

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
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const queryClient = useQueryClient();

  const debouncedSearch = useDebounce(searchTerm, 300);

  // Fire search whenever the debounced term changes
  React.useEffect(() => {
    if (debouncedSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    searchUsers(debouncedSearch).then(setSearchResults).catch(() => {});
  }, [debouncedSearch]);

  const mutation = useMutation({
    mutationFn: (userPk: number) => addMember(groupName, userPk),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group", groupPk] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
    onError: (err: unknown) => {
      setLocalError(extractApiError(err));
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
    <ModalShell title="Add Member">
      <p className="text-xs text-gray-500 -mt-2 mb-3">
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
                onChange={(e) => { setSearchTerm(e.target.value); setSelectedIndex(-1); }}
                onKeyDown={(e) => {
                  if (searchResults.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex((i) => Math.min(i + 1, searchResults.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex((i) => Math.max(i - 1, -1));
                  } else if (e.key === 'Enter') {
                    if (selectedIndex >= 0) {
                      e.preventDefault();
                      const u = searchResults[selectedIndex];
                      setSelectedUser(u);
                      setSearchResults([]);
                      setSearchTerm('');
                      setSelectedIndex(-1);
                    } else if (searchResults.length === 1) {
                      e.preventDefault();
                      const u = searchResults[0];
                      setSelectedUser(u);
                      setSearchResults([]);
                      setSearchTerm('');
                      setSelectedIndex(-1);
                    }
                  } else if (e.key === 'Escape') {
                    setSearchResults([]);
                    setSelectedIndex(-1);
                  }
                }}
                placeholder="e.g. alice"
                autoFocus
              />
              {searchResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map((u) => (
                    <li
                      key={u.pk}
                      className={`px-3 py-2 text-sm text-gray-800 cursor-pointer ${
                        searchResults.indexOf(u) === selectedIndex ? 'bg-indigo-50' : 'hover:bg-indigo-50'
                      }`}
                      onClick={() => {
                        setSelectedUser(u);
                        setSearchResults([]);
                        setSearchTerm("");
                        setSelectedIndex(-1);
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
        <ModalActions
          onCancel={onClose}
          isPending={mutation.isPending}
          submitLabel={mutation.isPending ? "Adding…" : "Add"}
        />
      </form>
    </ModalShell>
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
      setLocalError(extractApiError(err));
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
    <ModalShell title="Create Subgroup">
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
        <ModalActions
          onCancel={onClose}
          isPending={mutation.isPending}
          submitLabel={mutation.isPending ? "Creating…" : "Create"}
        />
      </form>
    </ModalShell>
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
      setLocalError(extractApiError(err));
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
    <ModalShell title="Connect Existing Group">
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
        <ModalActions
          onCancel={onClose}
          isPending={mutation.isPending}
          submitLabel={mutation.isPending ? "Connecting…" : "Connect"}
        />
      </form>
    </ModalShell>
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
      setLocalError(extractApiError(err));
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
    <ModalShell title="Resign as Leader">
      <p className="text-xs text-gray-500 -mt-2 mb-3">
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
        <ModalActions
          onCancel={onClose}
          isPending={mutation.isPending}
          submitLabel={mutation.isPending ? "Resigning…" : "Resign"}
          submitVariant="red"
          submitDisabled={members.length === 0 || confirmText !== groupName}
        />
      </form>
    </ModalShell>
  );
};

// ---------------------------------------------------------------------------
// Disband Group Modal
// ---------------------------------------------------------------------------
interface DisbandGroupModalProps {
  groupName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const DisbandGroupModal: React.FC<DisbandGroupModalProps> = ({
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
      setLocalError(extractApiError(err));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    mutation.mutate();
  };

  return (
    <ModalShell title="Disband group">
      <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 -mt-2 mb-3">
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
        <ModalActions
          onCancel={onClose}
          isPending={mutation.isPending}
          submitLabel={mutation.isPending ? "Disbanding…" : "Disband"}
          submitVariant="red"
          submitDisabled={confirmText !== groupName}
        />
      </form>
    </ModalShell>
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
