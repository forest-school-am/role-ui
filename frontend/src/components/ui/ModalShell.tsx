import React from 'react';

interface ModalShellProps {
  title: string;
  children: React.ReactNode;
}

/**
 * Full-screen backdrop + white card + title heading.
 * Wraps the content of all modals that were previously
 * using a hand-rolled `fixed inset-0 z-[60]` pattern.
 */
const ModalShell: React.FC<ModalShellProps> = ({ title, children }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
      <h3 className="text-base font-semibold text-gray-900 mb-3">{title}</h3>
      {children}
    </div>
  </div>
);

export default ModalShell;
