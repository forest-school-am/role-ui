import React, { useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useReactFlow,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GroupDetail, GroupNodeData } from "../../types";
import GroupNode, { type GroupNodeType } from "./GroupNode";

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

const nodeTypes: NodeTypes = {
  groupNode: GroupNode,
};

const COLUMN_WIDTH = 320;
const NODE_HEADER_HEIGHT = 42;
const NODE_MEMBER_ROW_HEIGHT = 24;
const NODE_MEMBER_MAX_HEIGHT = 192;
const NODE_FOOTER_PAD = 8;
const NODE_GAP = 20;

const VIRTUAL_NODE_WIDTH = 220;
const VIRTUAL_GAP = 60;
const VIRTUAL_Y_OFFSET = 120;

function computeLayout(
  groups: GroupDetail[],
  onGroupSelect: (name: string, isVirtual?: boolean) => void,
  onMemberClick: (username: string) => void,
): { nodes: GroupNodeType[]; edges: Edge[] } {
  // Deduplicate by name
  const groupByName = new Map<string, GroupDetail>();
  for (const g of groups) {
    groupByName.set(g.name, g);
  }
  const uniqueGroups = Array.from(groupByName.values());

  const realGroups = uniqueGroups.filter((g) => !g.is_virtual);
  const virtualGroups = uniqueGroups.filter((g) => g.is_virtual);

  const allRealNames = new Set(realGroups.map((g) => g.name));

  // Build children map: parent name -> child names
  const childrenOf = new Map<string, string[]>();
  for (const g of realGroups) {
    for (const parent of g.parents) {
      if (allRealNames.has(parent.name)) {
        if (!childrenOf.has(parent.name)) childrenOf.set(parent.name, []);
        childrenOf.get(parent.name)!.push(g.name);
      }
    }
  }

  // Column assignment via topological relaxation
  const columnOf = new Map<string, number>();

  for (const g of realGroups) {
    const relevantParents = g.parents.filter((p) => allRealNames.has(p.name));
    if (relevantParents.length === 0) {
      columnOf.set(g.name, 0);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const g of realGroups) {
      const relevantParents = g.parents.filter((p) => allRealNames.has(p.name));
      if (relevantParents.length === 0) continue;
      const maxParentCol = Math.max(
        ...relevantParents.map((p) => columnOf.get(p.name) ?? 0),
      );
      const desired = maxParentCol + 1;
      const current = columnOf.get(g.name) ?? -1;
      if (desired > current) {
        columnOf.set(g.name, desired);
        changed = true;
      }
    }
  }

  for (const g of realGroups) {
    if (!columnOf.has(g.name)) columnOf.set(g.name, 0);
  }

  const byColumn = new Map<number, string[]>();
  for (const [name, col] of columnOf.entries()) {
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(name);
  }

  function nodeHeight(name: string): number {
    const detail = groupByName.get(name);
    if (!detail) return NODE_HEADER_HEIGHT + NODE_FOOTER_PAD;
    const memberCount =
      detail.members.leader.length +
      detail.members.manager.length +
      detail.members.member.length;
    const memberSection = Math.min(
      memberCount * NODE_MEMBER_ROW_HEIGHT,
      NODE_MEMBER_MAX_HEIGHT,
    );
    return NODE_HEADER_HEIGHT + memberSection + NODE_FOOTER_PAD;
  }

  function packColumn(
    orderedNames: string[],
    desiredYCenters?: Map<string, number>,
  ): Map<string, number> {
    const n = orderedNames.length;
    const tops: number[] = new Array(n);

    let currentBottom = 0;
    for (let i = 0; i < n; i++) {
      const name = orderedNames[i];
      const next = orderedNames[i + 1];
      const h = nodeHeight(name);
      const desired = desiredYCenters?.get(name);
      const idealTop = desired !== undefined ? desired - h / 2 : currentBottom;
      if (idealTop > currentBottom) {
        if (next !== undefined) {
          const nextIdealTop = desiredYCenters?.get(next);
          if (nextIdealTop !== undefined) {
            if (nextIdealTop >= idealTop + h + NODE_GAP) {
              tops[i] = idealTop;
            }
          } else {
            tops[i] = idealTop;
          }
        } else {
          tops[i] = idealTop;
        }
      }
      if (tops[i] === undefined) {
        tops[i] = currentBottom;
      }
      currentBottom = tops[i] + h + NODE_GAP;
    }
    const yCenter = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const name = orderedNames[i];
      yCenter.set(name, tops[i] + nodeHeight(name) / 2);
    }
    return yCenter;
  }

  function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function computeOptimalRows(): Map<string, { yCenter: number; yTop: number }> {
    const connectedNames = new Set<string>();
    for (const [parentName, children] of childrenOf.entries()) {
      connectedNames.add(parentName);
      for (const c of children) connectedNames.add(c);
    }
    const isolatedNames = new Map<number, string[]>();
    for (const g of realGroups) {
      if (!connectedNames.has(g.name)) {
        const col = columnOf.get(g.name) ?? 0;
        if (!isolatedNames.has(col)) isolatedNames.set(col, []);
        isolatedNames.get(col)!.push(g.name);
      }
    }

    const parentsOf = new Map<string, string[]>();
    for (const [parentName, children] of childrenOf.entries()) {
      for (const childName of children) {
        if (!parentsOf.has(childName)) parentsOf.set(childName, []);
        parentsOf.get(childName)!.push(parentName);
      }
    }

    const columnOrder = new Map<number, string[]>();
    for (const [col, names] of byColumn.entries()) {
      const connected = names
        .filter((n) => connectedNames.has(n))
        .sort((a, b) => a.localeCompare(b));
      if (connected.length > 0) columnOrder.set(col, connected);
    }

    const yCenters = new Map<string, number>();
    for (const names of columnOrder.values()) {
      const packed = packColumn(names);
      for (const [name, yc] of packed.entries()) {
        yCenters.set(name, yc);
      }
    }

    const sortedCols = Array.from(columnOrder.keys()).sort((a, b) => a - b);

    function reorderColumn(col: number): void {
      const names = columnOrder.get(col);
      if (!names) return;

      const desiredY = new Map<string, number>();
      for (const name of names) {
        const neighbours: number[] = [];
        for (const p of parentsOf.get(name) ?? []) {
          if (columnOf.get(p) === col - 1 && yCenters.has(p)) {
            neighbours.push(yCenters.get(p)!);
          }
        }
        for (const c of childrenOf.get(name) ?? []) {
          if (columnOf.get(c) === col + 1 && yCenters.has(c)) {
            neighbours.push(yCenters.get(c)!);
          }
        }
        desiredY.set(
          name,
          neighbours.length > 0 ? median(neighbours) : (yCenters.get(name) ?? 0),
        );
      }

      const sorted = [...names].sort((a, b) => {
        const dy = (desiredY.get(a) ?? 0) - (desiredY.get(b) ?? 0);
        if (dy !== 0) return dy;
        return a.localeCompare(b);
      });
      columnOrder.set(col, sorted);

      const packed = packColumn(sorted, desiredY);
      for (const [name, yc] of packed.entries()) {
        yCenters.set(name, yc);
      }
    }

    function computeCost(): number {
      let cost = 0;
      for (const [parentName, children] of childrenOf.entries()) {
        for (const childName of children) {
          if (yCenters.has(parentName) && yCenters.has(childName)) {
            cost += Math.abs(yCenters.get(parentName)! - yCenters.get(childName)!);
          }
        }
      }
      return cost;
    }

    let prevCost = Infinity;
    for (let iter = 0; iter < 20; iter++) {
      for (const col of sortedCols) reorderColumn(col);
      for (const col of [...sortedCols].reverse()) reorderColumn(col);
      const currentCost = computeCost();
      if (currentCost === prevCost) break;
      prevCost = currentCost;
    }

    for (const [col, inames] of isolatedNames.entries()) {
      const connectedInCol = columnOrder.get(col) ?? [];
      let bottomY = 0;
      for (const name of connectedInCol) {
        const yc = yCenters.get(name) ?? 0;
        const bottom = yc + nodeHeight(name) / 2;
        if (bottom > bottomY) bottomY = bottom;
      }
      if (connectedInCol.length > 0) bottomY += NODE_GAP;

      const sortedIsolated = [...inames].sort((a, b) => a.localeCompare(b));
      let y = bottomY;
      for (const name of sortedIsolated) {
        const h = nodeHeight(name);
        yCenters.set(name, y + h / 2);
        y += h + NODE_GAP;
      }
    }

    const result = new Map<string, { yCenter: number; yTop: number }>();
    for (const g of realGroups) {
      const yc = yCenters.get(g.name) ?? 0;
      result.set(g.name, { yCenter: yc, yTop: yc - nodeHeight(g.name) / 2 });
    }
    return result;
  }

  const positionMap = computeOptimalRows();

  const nodes: GroupNodeType[] = realGroups.map((g) => {
    const col = columnOf.get(g.name) ?? 0;
    const { yTop } = positionMap.get(g.name) ?? { yTop: 0 };

    const data: GroupNodeData = {
      groupName: g.name,
      detail: { ...g, color: g.color ?? "#e2e8f0" },
      onSelect: onGroupSelect,
      onMemberClick,
      isVirtual: false,
    };

    return {
      id: g.name,
      type: "groupNode" as const,
      position: { x: col * COLUMN_WIDTH, y: yTop },
      data,
    };
  });

  const maxY = realGroups.reduce((max, g) => {
    const { yTop } = positionMap.get(g.name) ?? { yTop: 0 };
    return Math.max(max, yTop + nodeHeight(g.name));
  }, 0);

  const virtualY = maxY + VIRTUAL_Y_OFFSET;

  for (const vg of virtualGroups) {
    const virtualX = virtualGroups.indexOf(vg) * (VIRTUAL_NODE_WIDTH + VIRTUAL_GAP);

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
      data,
    });
  }

  const edges: Edge[] = [];
  for (const g of realGroups) {
    for (const parent of g.parents) {
      if (allRealNames.has(parent.name)) {
        const sourceGroup = groupByName.get(parent.name);
        const sourceColor = sourceGroup?.color ?? "#94a3b8";
        edges.push({
          id: `${parent.name}->${g.name}`,
          source: parent.name,
          target: g.name,
          style: { stroke: sourceColor, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: sourceColor },
        });
      }
    }
  }

  return { nodes, edges };
}

const DAGCanvas: React.FC<DAGCanvasProps> = ({
  groups,
  onGroupSelect,
  onMemberClick,
  focusNodeId,
  onFocusConsumed,
}) => {
  const { nodes, edges } = useMemo(
    () => computeLayout(groups, onGroupSelect, onMemberClick),
    [groups, onGroupSelect, onMemberClick],
  );

  return (
    <div style={{ width: "100%", height: "100%" }}>
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
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

export default DAGCanvas;
