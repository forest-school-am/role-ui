import React from 'react';

/**
 * Full-page loading skeleton — centred pulse bars.
 * Identical block previously duplicated in GroupPage + PersonalPage.
 */
const PageLoadingSkeleton: React.FC = () => (
  <div className="flex items-center justify-center h-full">
    <div className="space-y-3 w-full max-w-xl mx-auto p-8">
      <div className="h-8 rounded bg-gray-200 animate-pulse w-1/2" />
      <div className="h-4 rounded bg-gray-200 animate-pulse w-3/4" />
      <div className="h-4 rounded bg-gray-200 animate-pulse w-2/3" />
    </div>
  </div>
);

export default PageLoadingSkeleton;
