import React from 'react';

interface EditButtonProps {
  onClick: () => void;
  className?: string;
}

const EditButton: React.FC<EditButtonProps> = ({ onClick, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors ${className}`}
  >
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
    Edit
  </button>
);

export default EditButton;
