import React, { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type NodeTypes,
  type Edge,
} from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GroupDetail, GroupNodeData } from "../../types";
import GroupNode, { type GroupNodeType } from "../group/GroupNode";
import {
  LAYOUTS,
  type LayoutAlgorithm,
  NODE_CONTENT_WIDTH,
  NODE_HEADER_HEIGHT,
  NODE_MEMBER_ROW_HEIGHT,
  NODE_FOOTER_PAD,
  VIRTUAL_NODE_WIDTH,
  VIRTUAL_GAP,
  VIRTUAL_Y_OFFSET,
  type NodeInput,
} from "./layouts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DagFlowProps {
  groups: GroupDetail[];
  heightOverrides: Map<string, number>;
  algorithm: LayoutAlgorithm;
  onAlgorithmChange: (alg: LayoutAlgorithm) => void;
  onGroupSelect: (name: string, isVirtual?: boolean) => void;
  onMemberClick: (username: string) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}

// ---------------------------------------------------------------------------
// Inner controllers (need to be inside ReactFlowProvider)
// ---------------------------------------------------------------------------

function FocusController({
  focusNodeId,
  onFocusConsumed,
}: {
  focusNodeId: string | null;
  onFocusConsumed?: () => void;
}) {
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

/** Re-centres the canvas whenever the active layout algorithm changes. */
function FitOnAlgorithmChange({ algorithm }: { algorithm: LayoutAlgorithm }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 400, padding: 0.2 }), 50);
    return () => clearTimeout(t);
  }, [algorithm, fitView]);
  return null;
}

// ---------------------------------------------------------------------------
// Graph element builder (groups + positions → React Flow nodes + edges)
// ---------------------------------------------------------------------------

function buildGraphElements(
  groups: GroupDetail[],
  heightOverrides: Map<string, number>,
  algorithm: LayoutAlgorithm,
  onGroupSelect: (name: string, isVirtual?: boolean) => void,
  onMemberClick: (username: string) => void,
): { nodes: GroupNodeType[]; edges: Edge[] } {
  const groupByName = new Map<string, GroupDetail>();
  for (const g of groups) groupByName.set(g.name, g);
  const uniqueGroups = Array.from(groupByName.values());
  const realGroups = uniqueGroups.filter((g) => !g.is_virtual);
  const virtualGroups = uniqueGroups.filter((g) => g.is_virtual);
  const allRealNames = new Set(realGroups.map((g) => g.name));

  // Build children map from parent relationships.
  const childrenOf = new Map<string, string[]>();
  for (const g of realGroups) {
    for (const parent of g.parents) {
      if (!allRealNames.has(parent.name)) continue;
      if (!childrenOf.has(parent.name)) childrenOf.set(parent.name, []);
      childrenOf.get(parent.name)!.push(g.name);
    }
  }

  const nodeInputs = new Map<string, NodeInput>();
  for (const g of realGroups) {
    const parents = g.parents.filter((p) => allRealNames.has(p.name)).map((p) => p.name);
    const children = childrenOf.get(g.name) ?? [];
    const memberCount = g.members.leader.length + g.members.manager.length + g.members.member.length;
    const height =
      heightOverrides.get(g.name) ??
      NODE_HEADER_HEIGHT + memberCount * NODE_MEMBER_ROW_HEIGHT + NODE_FOOTER_PAD;
    nodeInputs.set(g.name, { parents, children, height });
  }

  const positions = LAYOUTS[algorithm].fn(nodeInputs);

  const nodes: GroupNodeType[] = realGroups.map((g) => {
    const pos = positions.get(g.name) ?? { x: 0, y: 0 };
    const memberCount = g.members.leader.length + g.members.manager.length + g.members.member.length;
    const height =
      heightOverrides.get(g.name) ??
      NODE_HEADER_HEIGHT + memberCount * NODE_MEMBER_ROW_HEIGHT + NODE_FOOTER_PAD;
    const data: GroupNodeData = {
      groupName: g.name,
      detail: { ...g, color: g.color ?? "#e2e8f0" },
      onSelect: onGroupSelect,
      onMemberClick,
      isVirtual: false,
    };
    return { id: g.name, type: "groupNode" as const, position: pos, width: NODE_CONTENT_WIDTH, height, data };
  });

  // Place virtual nodes in a row below all real nodes.
  const memberCountOf = (g: GroupDetail) =>
    g.members.leader.length + g.members.manager.length + g.members.member.length;

  const maxY = realGroups.reduce((max, g) => {
    const pos = positions.get(g.name);
    if (!pos) return max;
    const h =
      heightOverrides.get(g.name) ??
      NODE_HEADER_HEIGHT + memberCountOf(g) * NODE_MEMBER_ROW_HEIGHT + NODE_FOOTER_PAD;
    return Math.max(max, pos.y + h);
  }, 0);

  const virtualY = maxY + VIRTUAL_Y_OFFSET;
  for (const vg of virtualGroups) {
    const virtualX = virtualGroups.indexOf(vg) * (VIRTUAL_NODE_WIDTH + VIRTUAL_GAP);
    const vMemberCount = vg.members.leader.length + vg.members.manager.length + vg.members.member.length;
    const vHeight =
      heightOverrides.get(vg.name) ??
      NODE_HEADER_HEIGHT + vMemberCount * NODE_MEMBER_ROW_HEIGHT + NODE_FOOTER_PAD;
    const data: GroupNodeData = {
      groupName: vg.name,
      detail: { ...vg, color: vg.color ?? "#e5e7eb" },
      onSelect: onGroupSelect,
      onMemberClick,
      isVirtual: true,
    };
    nodes.push({
      id: vg.name,
      type: "groupNode" as const,
      position: { x: virtualX, y: virtualY },
      width: VIRTUAL_NODE_WIDTH,
      height: vHeight,
      data,
    });
  }

  const edges: Edge[] = [];
  for (const g of realGroups) {
    for (const parent of g.parents) {
      if (!allRealNames.has(parent.name)) continue;
      const sourceColor = groupByName.get(parent.name)?.color ?? "#94a3b8";
      edges.push({
        id: `${parent.name}->${g.name}`,
        source: parent.name,
        target: g.name,
        style: { stroke: sourceColor, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: sourceColor },
      });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Node type registry
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = { groupNode: GroupNode };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DagFlow: React.FC<DagFlowProps> = ({
  groups,
  heightOverrides,
  algorithm,
  onAlgorithmChange,
  onGroupSelect,
  onMemberClick,
  focusNodeId,
  onFocusConsumed,
}) => {
  const { nodes, edges } = useMemo(
    () => buildGraphElements(groups, heightOverrides, algorithm, onGroupSelect, onMemberClick),
    [groups, heightOverrides, algorithm, onGroupSelect, onMemberClick],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      attributionPosition="bottom-right"
    >
      <FocusController focusNodeId={focusNodeId ?? null} onFocusConsumed={onFocusConsumed} />
      <FitOnAlgorithmChange algorithm={algorithm} />
      <Panel position="top-left">
        <div className="flex gap-1 text-xs">
          {(Object.keys(LAYOUTS) as LayoutAlgorithm[]).map((alg) => (
            <button
              key={alg}
              onClick={() => onAlgorithmChange(alg)}
              className={`px-2 py-1 rounded border transition-colors ${
                algorithm === alg
                  ? "bg-blue-500 text-white border-blue-500"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {LAYOUTS[alg].label}
            </button>
          ))}
        </div>
      </Panel>
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
};

export default DagFlow;
