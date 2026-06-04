import React from 'react';

interface PageErrorCardProps {
  title?: string;
  message: string;
  children?: React.ReactNode;
}

/**
 * Full-page error card with optional action children (e.g. a Sign Out button).
 * Previously duplicated in GroupPage + PersonalPage.
 */
const PageErrorCard: React.FC<PageErrorCardProps> = ({
  title = 'Error',
  message,
  children,
}) => (
  <div className="flex items-center justify-center h-full p-8">
    <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800 max-w-md w-full">
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      <p className="text-sm mb-4">{message}</p>
      {children}
    </div>
  </div>
);

export default PageErrorCard;
