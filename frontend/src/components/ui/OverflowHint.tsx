import React from 'react';
import { useNavigate } from 'react-router-dom';

interface OverflowHintProps {
  /** Number of items hidden. */
  count: number;
  /** Group name used to build the navigation URL. */
  groupName: string;
}

/**
 * "+N more — see all" hint shown when a list is truncated in a preview panel.
 * Navigates to the group detail page on click.
 */
const OverflowHint: React.FC<OverflowHintProps> = ({ count, groupName }) => {
  const navigate = useNavigate();

  if (count <= 0) return null;

  return (
    <p className="text-xs text-gray-400 italic pl-2">
      +{count} more —{' '}
      <button
        className="underline"
        onClick={() => navigate('/groups/' + encodeURIComponent(groupName))}
      >
        see all
      </button>
    </p>
  );
};

export default OverflowHint;
