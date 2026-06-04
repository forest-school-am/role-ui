import { useState } from 'react';

export type GroupModalName =
  | 'addMember'
  | 'createSubgroup'
  | 'addChildGroup'
  | 'resignLeader'
  | 'disband';

interface UseGroupModalsReturn {
  activeModal: GroupModalName | null;
  open: (name: GroupModalName) => void;
  close: () => void;
}

/**
 * Manages the single active modal for a group page or panel.
 * Replaces 5x useState(false) booleans.
 */
export function useGroupModals(): UseGroupModalsReturn {
  const [activeModal, setActiveModal] = useState<GroupModalName | null>(null);

  return {
    activeModal,
    open: (name: GroupModalName) => setActiveModal(name),
    close: () => setActiveModal(null),
  };
}
