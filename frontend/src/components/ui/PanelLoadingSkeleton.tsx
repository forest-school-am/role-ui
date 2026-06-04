import React from 'react';

interface PanelLoadingSkeletonProps {
  /** Number of skeleton rows (default 3). */
  rows?: number;
  /** Tailwind height step for each bar — e.g. 6 → h-6 (default 6). */
  height?: number;
}

/**
 * Animate-pulse list skeleton used inside side-panels.
 * Previously duplicated in GroupPreviewPanel, UserPreviewPanel, GroupDetailPanel.
 */
const PanelLoadingSkeleton: React.FC<PanelLoadingSkeletonProps> = ({
  rows = 3,
  height = 6,
}) => (
  <div className="space-y-2">
    {Array.from({ length: rows }, (_, i) => (
      <div
        key={i}
        className={`h-${height} rounded bg-gray-100 animate-pulse`}
      />
    ))}
  </div>
);

export default PanelLoadingSkeleton;
