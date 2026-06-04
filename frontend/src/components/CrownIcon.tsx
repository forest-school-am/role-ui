import React from 'react';
import type { CrownVariant, CrownSize } from '../types';

interface CrownIconProps {
  variant: CrownVariant;
  size?: CrownSize;
}

const SIZE_PX: Record<CrownSize, number> = {
  sm: 14,
  md: 20,
};

const COLOR: Record<CrownVariant, string> = {
  gold: '#FFD700',
  silver: '#C0C0C0',
};

const CrownIcon: React.FC<CrownIconProps> = ({ variant, size = 'sm' }) => {
  const px = SIZE_PX[size];
  const fill = COLOR[variant];

  // Simple 3-point crown shape drawn on a 20x16 viewBox
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 20 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={`${variant} crown`}
      role="img"
    >
      {/* Crown outline: left spike, middle spike (tallest), right spike, base */}
      <polygon
        points="0,14 2,6 6,10 10,0 14,10 18,6 20,14"
        fill={fill}
        stroke={fill}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Base bar */}
      <rect x="0" y="13" width="20" height="3" rx="1" fill={fill} />
    </svg>
  );
};

export default CrownIcon;
