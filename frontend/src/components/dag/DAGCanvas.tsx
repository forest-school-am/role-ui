import React, { useLayoutEffect, useMemo, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GroupDetail } from "../../types";
import GroupNode from "../group/GroupNode";
import GroupNodeContent from "../group/GroupNodeContent";
import { computeLayout, type LayoutAlgorithm } from "./dagLayout";

interface DAGCanvasProps {
  groups: GroupDetail[];
  onGroupSelect: (name: string, isVirtual?: boolean) => void;
  onMemberClick: (username: string) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}

interface FocusControllerProps {
  focusNodeId: string | null;
  onFocusConsumed?: () => void;
}

function FocusController({ focusNodeId, onFocusConsumed }: FocusControllerProps) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!focusNodeId) return;
    const t = setTimeout(() => {
      fitView({ nodes: [{ id: focusNodeId }], duration: 600, padding: 0.5 });
      onFocusConsumed?.();
    }, 100);
    return () => clearTimeout(t);
  }, [focusNodeId, fitView, onFocusConsumed]);
  return null;
}

// ---------------------------------------------------------------------------
// Off-screen measurement
// ---------------------------------------------------------------------------

interface MeasureNodesProps {
  groups: GroupDetail[];
  onMeasured: (heights: Map<string, number>) => void;
}

function MeasureNodes({ groups, onMeasured }: MeasureNodesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a stable ref to the callback so the effect dep array stays clean.
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
}

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  groupNode: GroupNode,
};

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

const DAGCanvas: React.FC<DAGCanvasProps> = ({
  groups,
  onGroupSelect,
  onMemberClick,
  focusNodeId,
  onFocusConsumed,
}) => {
  const [measuredHeights, setMeasuredHeights] = useState<Map<string, number> | null>(null);
  const [algorithm, setAlgorithm] = useState<LayoutAlgorithm>("spring");

  // Deduplicate so MeasureNodes renders each group exactly once.
  const uniqueGroups = useMemo(() => {
    const map = new Map<string, GroupDetail>();
    for (const g of groups) map.set(g.name, g);
    return Array.from(map.values());
  }, [groups]);

  const { nodes, edges } = useMemo(
    () =>
      measuredHeights
        ? computeLayout(groups, onGroupSelect, onMemberClick, measuredHeights, algorithm)
        : { nodes: [], edges: [] },
    [groups, onGroupSelect, onMemberClick, measuredHeights, algorithm],
  );

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* Always mounted so useLayoutEffect re-fires whenever groups change. */}
      <MeasureNodes groups={uniqueGroups} onMeasured={setMeasuredHeights} />

      {measuredHeights && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          attributionPosition="bottom-right"
        >
          <FocusController
            focusNodeId={focusNodeId ?? null}
            onFocusConsumed={onFocusConsumed}
          />
          <Panel position="top-left">
            <div className="flex gap-1 text-xs">
              {(["spring", "sugiyama"] as LayoutAlgorithm[]).map((alg) => (
                <button
                  key={alg}
                  onClick={() => setAlgorithm(alg)}
                  className={`px-2 py-1 rounded border transition-colors ${
                    algorithm === alg
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {alg}
                </button>
              ))}
            </div>
          </Panel>
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      )}
    </div>
  );
};

export default DAGCanvas;
