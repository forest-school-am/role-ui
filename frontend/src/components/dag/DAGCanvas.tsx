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
  onGroupSelect: (pk: string, name: string) => void;
  onMemberClick: (username: string) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}

interface FocusControllerProps {
  focusNodeId: string | null;    // now a group name
  groups: GroupDetail[];
  onFocusConsumed?: () => void;
}

function FocusController({
  focusNodeId,
  groups,
  onFocusConsumed,
}: FocusControllerProps) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!focusNodeId) return;
    // Resolve name → pk
    const group = groups.find(g => g.name === focusNodeId);
    const nodeId = group?.pk ?? focusNodeId; // fallback to raw value
    const t = setTimeout(() => {
      fitView({ nodes: [{ id: nodeId }], duration: 600, padding: 0.5 });
      onFocusConsumed?.();
    }, 100);
    return () => clearTimeout(t);
  }, [focusNodeId, groups, fitView, onFocusConsumed]);
  return null;
}

const nodeTypes: NodeTypes = {
  groupNode: GroupNode,
};

const COLUMN_WIDTH = 320;

const NODE_HEADER_HEIGHT = 42;
const NODE_MEMBER_ROW_HEIGHT = 24;
const NODE_MEMBER_MAX_HEIGHT = 192; // max-h-48 = 48*4px
const NODE_FOOTER_PAD = 8;
const NODE_GAP = 20;

const VIRTUAL_NODE_WIDTH = 220;
const VIRTUAL_GAP = 60;
const VIRTUAL_Y_OFFSET = 120;

const VIRTUAL_X_POSITIONS: Record<string, number> = {
  "virtual:unassigned": 0,
  "virtual:suspended": VIRTUAL_NODE_WIDTH + VIRTUAL_GAP,
};

function computeLayout(
  groups: GroupDetail[],
  onGroupSelect: (pk: string, name: string) => void,
  onMemberClick: (username: string) => void,
): { nodes: GroupNodeType[]; edges: Edge[] } {
  // Deduplicate by pk — each group must appear exactly once
  const groupByPk = new Map<string, GroupDetail>();
  for (const g of groups) {
    groupByPk.set(g.pk, g);
  }
  const uniqueGroups = Array.from(groupByPk.values());

  // Separate real and virtual groups
  const realGroups = uniqueGroups.filter((g) => !g.is_virtual);
  const virtualGroups = uniqueGroups.filter((g) => g.is_virtual);

  const allRealPks = new Set(realGroups.map((g) => g.pk));

  // Build children map: parent pk -> child pks (real groups only)
  const childrenOf = new Map<string, string[]>();
  for (const g of realGroups) {
    for (const parentPk of g.parent_pks) {
      if (allRealPks.has(parentPk)) {
        if (!childrenOf.has(parentPk)) childrenOf.set(parentPk, []);
        childrenOf.get(parentPk)!.push(g.pk);
      }
    }
  }

  // Column assignment: each node gets max(parent_cols) + 1.
  // Use a topological relaxation pass (iterate until stable) so that
  // diamond-shaped DAGs (node with multiple parents) always land in the
  // correct column even if one parent is processed after the child.
  const columnOf = new Map<string, number>();

  // Roots (no known parents in the dataset) start at column 0
  for (const g of realGroups) {
    const relevantParents = g.parent_pks.filter((p) => allRealPks.has(p));
    if (relevantParents.length === 0) {
      columnOf.set(g.pk, 0);
    }
  }

  // Iterative relaxation: repeat until no column value changes
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of realGroups) {
      const relevantParents = g.parent_pks.filter((p) => allRealPks.has(p));
      if (relevantParents.length === 0) continue;
      const maxParentCol = Math.max(
        ...relevantParents.map((p) => columnOf.get(p) ?? 0),
      );
      const desired = maxParentCol + 1;
      const current = columnOf.get(g.pk) ?? -1;
      if (desired > current) {
        columnOf.set(g.pk, desired);
        changed = true;
      }
    }
  }

  // Any disconnected real groups not yet assigned go to column 0
  for (const g of realGroups) {
    if (!columnOf.has(g.pk)) columnOf.set(g.pk, 0);
  }

  // Group by column
  const byColumn = new Map<number, string[]>();
  for (const [pk, col] of columnOf.entries()) {
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(pk);
  }

  // ── Phase 2: pixel-position row assignment ──────────────────────────────

  // Helper: height of a node given its pk
  function nodeHeight(pk: string): number {
    const detail = groupByPk.get(pk);
    if (!detail) return NODE_HEADER_HEIGHT + NODE_FOOTER_PAD;
    const memberCount =
      (detail.leader ? 1 : 0) + detail.managers.length + detail.members.length;
    const memberSection = Math.min(
      memberCount * NODE_MEMBER_ROW_HEIGHT,
      NODE_MEMBER_MAX_HEIGHT,
    );
    return NODE_HEADER_HEIGHT + memberSection + NODE_FOOTER_PAD;
  }

  // Helper: pack a list of pks top-to-bottom with two-pass refinement, return pk → yCenter
  function packColumn(
    orderedPks: string[],
    desiredYCenters?: Map<string, number>,
  ): Map<string, number> {
    const n = orderedPks.length;
    const tops: number[] = new Array(n);

    // Forward pass: push nodes down so no overlap occurs
    let currentBottom = 0;
    for (let i = 0; i < n; i++) {
      const pk = orderedPks[i];
      const next = orderedPks[i + 1];
      const h = nodeHeight(pk);
      const desired = desiredYCenters?.get(pk);
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
    // Build output map from final tops array
    const yCenter = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const pk = orderedPks[i];
      yCenter.set(pk, tops[i] + nodeHeight(pk) / 2);
    }
    return yCenter;
  }

  // Helper: median of a number array (float, used for sorting only)
  function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function computeOptimalRows(): Map<
    string,
    { yCenter: number; yTop: number }
  > {
    // Step 1: Classify nodes into connected vs isolated
    const connectedPks = new Set<string>();
    for (const [parentPk, children] of childrenOf.entries()) {
      connectedPks.add(parentPk);
      for (const c of children) connectedPks.add(c);
    }
    const isolatedPks = new Map<number, string[]>(); // col → pks
    for (const g of realGroups) {
      if (!connectedPks.has(g.pk)) {
        const col = columnOf.get(g.pk) ?? 0;
        if (!isolatedPks.has(col)) isolatedPks.set(col, []);
        isolatedPks.get(col)!.push(g.pk);
      }
    }

    // Step 2: Build parentsOf (invert childrenOf)
    const parentsOf = new Map<string, string[]>();
    for (const [parentPk, children] of childrenOf.entries()) {
      for (const childPk of children) {
        if (!parentsOf.has(childPk)) parentsOf.set(childPk, []);
        parentsOf.get(childPk)!.push(parentPk);
      }
    }

    // Step 3: Initialize column ordering (connected nodes only, sorted alpha)
    const columnOrder = new Map<number, string[]>();
    for (const [col, pks] of byColumn.entries()) {
      const connected = pks
        .filter((pk) => connectedPks.has(pk))
        .sort((a, b) => {
          const na = groupByPk.get(a)?.name ?? a;
          const nb = groupByPk.get(b)?.name ?? b;
          return na.localeCompare(nb);
        });
      if (connected.length > 0) columnOrder.set(col, connected);
    }

    // Initial yCenters from pack
    const yCenters = new Map<string, number>();
    for (const pks of columnOrder.values()) {
      const packed = packColumn(pks);
      for (const [pk, yc] of packed.entries()) {
        yCenters.set(pk, yc);
      }
    }

    // Step 4: Coordinate descent loop
    const sortedCols = Array.from(columnOrder.keys()).sort((a, b) => a - b);

    function reorderColumn(col: number): void {
      const pks = columnOrder.get(col);
      if (!pks) return;

      // Compute desiredY for each pk in this column
      const desiredY = new Map<string, number>();
      for (const pk of pks) {
        const neighbours: number[] = [];
        // Parents in col - 1
        for (const p of parentsOf.get(pk) ?? []) {
          if (columnOf.get(p) === col - 1 && yCenters.has(p)) {
            neighbours.push(yCenters.get(p)!);
          }
        }
        // Children in col + 1
        for (const c of childrenOf.get(pk) ?? []) {
          if (columnOf.get(c) === col + 1 && yCenters.has(c)) {
            neighbours.push(yCenters.get(c)!);
          }
        }
        desiredY.set(
          pk,
          neighbours.length > 0 ? median(neighbours) : (yCenters.get(pk) ?? 0),
        );
      }

      // Sort by desiredY, tie-break by pk string
      const sorted = [...pks].sort((a, b) => {
        const dy = (desiredY.get(a) ?? 0) - (desiredY.get(b) ?? 0);
        if (dy !== 0) return dy;
        return a.localeCompare(b);
      });
      columnOrder.set(col, sorted);

      // Re-pack this column
      const packed = packColumn(sorted, desiredY);
      for (const [pk, yc] of packed.entries()) {
        yCenters.set(pk, yc);
      }
    }

    function computeCost(): number {
      let cost = 0;
      for (const [parentPk, children] of childrenOf.entries()) {
        for (const childPk of children) {
          if (yCenters.has(parentPk) && yCenters.has(childPk)) {
            cost += Math.abs(yCenters.get(parentPk)! - yCenters.get(childPk)!);
          }
        }
      }
      return cost;
    }

    let prevCost = Infinity;
    for (let iter = 0; iter < 20; iter++) {
      // Forward sweep
      for (const col of sortedCols) reorderColumn(col);
      // Backward sweep
      for (const col of [...sortedCols].reverse()) reorderColumn(col);

      const currentCost = computeCost();
      if (currentCost === prevCost) break;
      prevCost = currentCost;
    }

    // Step 5: Place isolated nodes below connected nodes, per column
    for (const [col, ipks] of isolatedPks.entries()) {
      // Find bottom of last connected node in this column
      const connectedInCol = columnOrder.get(col) ?? [];
      let bottomY = 0;
      for (const pk of connectedInCol) {
        const yc = yCenters.get(pk) ?? 0;
        const bottom = yc + nodeHeight(pk) / 2;
        if (bottom > bottomY) bottomY = bottom;
      }
      if (connectedInCol.length > 0) bottomY += NODE_GAP;

      // Sort isolated nodes alphabetically by name
      const sortedIsolated = [...ipks].sort((a, b) => {
        const na = groupByPk.get(a)?.name ?? a;
        const nb = groupByPk.get(b)?.name ?? b;
        return na.localeCompare(nb);
      });

      // Pack them starting from bottomY
      let y = bottomY;
      for (const pk of sortedIsolated) {
        const h = nodeHeight(pk);
        yCenters.set(pk, y + h / 2);
        y += h + NODE_GAP;
      }
    }

    // Step 6: Build output map
    const result = new Map<string, { yCenter: number; yTop: number }>();
    for (const g of realGroups) {
      const yc = yCenters.get(g.pk) ?? 0;
      result.set(g.pk, { yCenter: yc, yTop: yc - nodeHeight(g.pk) / 2 });
    }
    return result;
  }

  const positionMap = computeOptimalRows();

  // Build real nodes
  const nodes: GroupNodeType[] = realGroups.map((g) => {
    const col = columnOf.get(g.pk) ?? 0;
    const { yTop } = positionMap.get(g.pk) ?? { yTop: 0 };

    const data: GroupNodeData = {
      groupPk: g.pk,
      groupName: g.name,
      detail: { ...g, color: g.color ?? "#e2e8f0" },
      onSelect: onGroupSelect,
      onMemberClick,
      isVirtual: false,
    };

    return {
      id: g.pk,
      type: "groupNode" as const,
      position: { x: col * COLUMN_WIDTH, y: yTop },
      data,
    };
  });

  // Find the bottom edge of all real nodes
  const maxY = realGroups.reduce((max, g) => {
    const { yTop } = positionMap.get(g.pk) ?? { yTop: 0 };
    return Math.max(max, yTop + nodeHeight(g.pk));
  }, 0);

  // Position virtual nodes below the real DAG, side by side
  const virtualY = maxY + VIRTUAL_Y_OFFSET;

  for (const g of virtualGroups) {
    const virtualX = VIRTUAL_X_POSITIONS[g.pk] ?? 0;

    const data: GroupNodeData = {
      groupPk: g.pk,
      groupName: g.name,
      detail: { ...g, color: g.color ?? "#e5e7eb" },
      onSelect: onGroupSelect,
      onMemberClick,
      isVirtual: true,
    };

    nodes.push({
      id: g.pk,
      type: "groupNode" as const,
      position: { x: virtualX, y: virtualY },
      data,
    });
  }

  const edges: Edge[] = [];
  for (const g of realGroups) {
    for (const parentPk of g.parent_pks) {
      if (allRealPks.has(parentPk)) {
        const sourceGroup = groupByPk.get(parentPk);
        const sourceColor = sourceGroup?.color ?? "#94a3b8"; // default slate-400
        edges.push({
          id: `${parentPk}->${g.pk}`,
          source: parentPk,
          target: g.pk,
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
          groups={groups}
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
