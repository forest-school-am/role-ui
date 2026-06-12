import React, { useLayoutEffect, useRef } from "react";
import type { GroupDetail } from "../../types";
import GroupNodeContent from "../group/GroupNodeContent";

interface MeasureNodesProps {
  groups: GroupDetail[];
  onMeasured: (heights: Map<string, number>) => void;
}

/**
 * Renders every group node off-screen in a hidden container so its real DOM
 * height can be measured before the visible layout is computed.
 */
const MeasureNodes: React.FC<MeasureNodesProps> = ({ groups, onMeasured }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const heights = new Map<string, number>();
    for (const child of container.children) {
      const name = (child as HTMLElement).dataset.name;
      if (name) heights.set(name, child.getBoundingClientRect().height);
    }
    onMeasuredRef.current(heights);
  }, [groups]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        left: "-9999px",
        top: 0,
        visibility: "hidden",
        pointerEvents: "none",
      }}
    >
      {groups.map((g) => (
        <div key={g.name} data-name={g.name}>
          <GroupNodeContent
            groupName={g.name}
            detail={g}
            isVirtual={g.is_virtual}
          />
        </div>
      ))}
    </div>
  );
};

export default MeasureNodes;
