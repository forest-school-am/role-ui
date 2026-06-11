import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toggleNameFreeze } from '../../api/users';
import { extractApiError } from '../../api/client';

interface NameFreezeToggleProps {
  username: string;
  frozen: boolean;
  className?: string;
}

const LockClosedIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
  </svg>
);

const LockOpenIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5a3 3 0 016 0v.75a.75.75 0 001.5 0V5.5A4.5 4.5 0 0010 1z" />
  </svg>
);

const NameFreezeToggle: React.FC<NameFreezeToggleProps> = ({ username, frozen, className = '' }) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => toggleNameFreeze(username),
    onSuccess: () => {
      void queryClient.refetchQueries({ queryKey: ['user', username] });
      void queryClient.refetchQueries({ queryKey: ['me'] });
    },
  });

  const isPending = mutation.isPending;
  const err = mutation.error;

  return (
    <button
      type="button"
      title={err ? extractApiError(err) : frozen ? 'Unfreeze name' : 'Freeze name'}
      disabled={isPending}
      onClick={() => mutation.mutate(undefined)}
      className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-50 ${
        frozen
          ? 'text-amber-600 hover:text-amber-800'
          : 'text-gray-400 hover:text-gray-600'
      } ${className}`}
    >
      {frozen ? <LockClosedIcon /> : <LockOpenIcon />}
      {frozen ? 'Unfreeze' : 'Freeze'}
    </button>
  );
};

export default NameFreezeToggle;
