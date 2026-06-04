import React from 'react';

interface ModalActionsProps {
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
  /** Visual colour of the submit button. Default: 'indigo'. */
  submitVariant?: 'indigo' | 'red';
  submitDisabled?: boolean;
}

/**
 * Cancel + Submit button pair used in all modals.
 */
const ModalActions: React.FC<ModalActionsProps> = ({
  onCancel,
  isPending,
  submitLabel,
  submitVariant = 'indigo',
  submitDisabled,
}) => {
  const submitCls =
    submitVariant === 'red'
      ? 'rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60'
      : 'rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60';

  return (
    <div className="flex gap-2 justify-end pt-1">
      <button
        type="button"
        className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        onClick={onCancel}
        disabled={isPending}
      >
        Cancel
      </button>
      <button
        type="submit"
        className={submitCls}
        disabled={isPending || submitDisabled}
      >
        {submitLabel}
      </button>
    </div>
  );
};

export default ModalActions;
