import React, { useMemo, useState } from "react";
import type { GroupDetail } from "../../types";
import MeasureNodes from "./MeasureNodes";
import DagFlow from "./DagFlow";
import { type LayoutAlgorithm } from "./layouts";

interface DAGCanvasProps {
  groups: GroupDetail[];
  onGroupSelect: (name: string, isVirtual?: boolean) => void;
  onMemberClick: (username: string) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}

const DAGCanvas: React.FC<DAGCanvasProps> = ({
  groups,
  onGroupSelect,
  onMemberClick,
  focusNodeId,
  onFocusConsumed,
}) => {
  const [measuredHeights, setMeasuredHeights] = useState<Map<string, number> | null>(null);
  const [algorithm, setAlgorithm] = useState<LayoutAlgorithm>("sugiyama");

  // Deduplicate so MeasureNodes renders each group exactly once.
  const uniqueGroups = useMemo(() => {
    const map = new Map<string, GroupDetail>();
    for (const g of groups) map.set(g.name, g);
    return Array.from(map.values());
  }, [groups]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* Always mounted so useLayoutEffect re-fires whenever groups change. */}
      <MeasureNodes groups={uniqueGroups} onMeasured={setMeasuredHeights} />

      {measuredHeights && (
        <DagFlow
          groups={groups}
          heightOverrides={measuredHeights}
          algorithm={algorithm}
          onAlgorithmChange={setAlgorithm}
          onGroupSelect={onGroupSelect}
          onMemberClick={onMemberClick}
          focusNodeId={focusNodeId}
          onFocusConsumed={onFocusConsumed}
        />
      )}
    </div>
  );
};

export default DAGCanvas;
