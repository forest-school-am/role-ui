import React from 'react';

interface DashedButtonProps {
  color: 'indigo' | 'gray' | 'red';
  /**
   * 'dark' only applies to the red color to produce a slightly stronger border/text
   * (used for "Disband group" actions).
   */
  variant?: 'default' | 'dark';
  size?: 'sm' | 'xs';
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const COLOR_MAP: Record<
  string,
  { border: string; text: string; hover: string }
> = {
  indigo: {
    border: 'border-indigo-300',
    text: 'text-indigo-600',
    hover: 'hover:bg-indigo-50',
  },
  gray: {
    border: 'border-gray-300',
    text: 'text-gray-600',
    hover: 'hover:bg-gray-50',
  },
  red: {
    border: 'border-red-300',
    text: 'text-red-600',
    hover: 'hover:bg-red-50',
  },
  'red-dark': {
    border: 'border-red-400',
    text: 'text-red-700',
    hover: 'hover:bg-red-50',
  },
};

/**
 * Full-width dashed border action button.
 * Use color="red" + variant="dark" for the "Disband group" destructive variant.
 */
const DashedButton: React.FC<DashedButtonProps> = ({
  color,
  variant = 'default',
  size = 'sm',
  onClick,
  disabled,
  children,
}) => {
  const colorKey = color === 'red' && variant === 'dark' ? 'red-dark' : color;
  const { border, text, hover } = COLOR_MAP[colorKey];
  const textSize = size === 'xs' ? 'text-xs' : 'text-sm';
  const padding = size === 'xs' ? 'py-1' : 'py-2';

  return (
    <button
      type="button"
      className={`w-full rounded border border-dashed ${border} ${padding} ${textSize} ${text} ${hover} transition-colors disabled:opacity-50`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

export default DashedButton;
