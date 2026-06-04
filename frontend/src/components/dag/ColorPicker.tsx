import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setGroupColor } from '../../api/groups';

const PALETTE = [
  '#ffd6d6', // rose
  '#ffd9b3', // peach
  '#fff4b3', // lemon
  '#d6f5d6', // mint
  '#b3e6ff', // sky
  '#d6d6ff', // lavender
  '#ffb3d9', // pink
  '#b3ffe0', // aqua
  '#ffe0b3', // apricot
  '#e0b3ff', // lilac
  '#b3fff4', // teal
  '#f5f5f5', // neutral (no color)
];

interface ColorPickerProps {
  currentColor?: string;
  groupName: string;
  groupPk: string;
  onColorChange: (color: string) => void;
}

const ColorPicker: React.FC<ColorPickerProps> = ({
  currentColor,
  groupName,
  groupPk,
  onColorChange,
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (color: string) => setGroupColor(groupName, color),
    onSuccess: (_data, color) => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['group', groupPk] });
      onColorChange(color);
    },
  });

  const handleClick = (e: React.MouseEvent, color: string) => {
    e.stopPropagation();
    // Clicking the neutral swatch clears the color
    const valueToSend = color === '#f5f5f5' ? '' : color;
    mutation.mutate(valueToSend);
  };

  return (
    <div className="flex flex-wrap gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
      {PALETTE.map((color) => {
        const isSelected =
          color === '#f5f5f5'
            ? !currentColor || currentColor === '' || currentColor === '#f5f5f5'
            : currentColor === color;
        return (
          <button
            key={color}
            title={color === '#f5f5f5' ? 'No color' : color}
            disabled={mutation.isPending}
            onClick={(e) => handleClick(e, color)}
            className={`w-5 h-5 rounded-full cursor-pointer border border-gray-300 disabled:opacity-50 ${
              isSelected ? 'ring-2 ring-offset-1 ring-gray-400' : ''
            }`}
            style={{ backgroundColor: color }}
          />
        );
      })}
    </div>
  );
};

export default ColorPicker;
