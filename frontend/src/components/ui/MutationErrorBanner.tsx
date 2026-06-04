import React from 'react';

interface MutationErrorBannerProps {
  message?: string | null;
}

/**
 * Inline red error paragraph.
 * Renders nothing when message is null or undefined.
 */
const MutationErrorBanner: React.FC<MutationErrorBannerProps> = ({ message }) => {
  if (!message) return null;
  return (
    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
      {message}
    </p>
  );
};

export default MutationErrorBanner;
