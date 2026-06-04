import React from 'react';

/**
 * Small italic gray "empty state" note.
 * Replaces all inline `<p className="text-sm text-gray-400 italic">` patterns.
 */
const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-sm text-gray-400 italic">{children}</p>
);

export default EmptyNote;
