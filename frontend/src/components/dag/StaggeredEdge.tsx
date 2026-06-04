import type { EdgeProps } from '@xyflow/react';

function hashEdgeId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return (h >>> 0) / 0xffffffff; // float 0..1
}

export function StaggeredEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  const isAligned = Math.abs(targetX - sourceX) < 4;
  let d: string;

  if (isAligned) {
    d = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  } else {
    const verticalSpan = targetY - sourceY;
    const rand = hashEdgeId(id);
    // split Y in the middle third: [sourceY + span/3, sourceY + 2*span/3]
    const splitY = sourceY + verticalSpan / 3 + rand * (verticalSpan / 3);
    const centerY = (sourceY + targetY) / 2;
    const cornerOffset = hashEdgeId(id + '_offset') * 16;
    // shift corners toward centerY
    const adjustedSplitY = splitY + (centerY > splitY ? cornerOffset : -cornerOffset);

    d = [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceX} ${adjustedSplitY}`,
      `L ${targetX} ${adjustedSplitY}`,
      `L ${targetX} ${targetY}`,
    ].join(' ');
  }

  return (
    <path
      d={d}
      style={{ fill: 'none', ...style }}
      className="react-flow__edge-path"
      markerEnd={markerEnd as string}
    />
  );
}
