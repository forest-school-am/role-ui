import { MarkerType, type Edge } from "@xyflow/react";
import type { GroupDetail, GroupNodeData } from "../../types";
import type { GroupNodeType } from "../group/GroupNode";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const COLUMN_WIDTH = 320;
export const NODE_HEADER_HEIGHT = 42;
export const NODE_MEMBER_ROW_HEIGHT = 24;
export const NODE_FOOTER_PAD = 8;
export const NODE_GAP = 20;

export const VIRTUAL_NODE_WIDTH = 220;
export const VIRTUAL_GAP = 60;
export const VIRTUAL_Y_OFFSET = 120;

// ---------------------------------------------------------------------------
// Pure geometry types and functions
// ---------------------------------------------------------------------------

export type NodeInput = {
  parents: string[];
  children: string[];
  height: number;
};

export function computeNodeTops(
  nodes: Map<string, NodeInput>,
): Map<string, number> {
  // Step 1 — Column assignment
  const columnOf = new Map<string, number>();

  for (const [id, n] of nodes) {
    if (n.parents.length === 0) columnOf.set(id, 0);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, n] of nodes) {
      if (n.parents.length === 0) continue;
      const maxParentCol = Math.max(...n.parents.map((p) => columnOf.get(p) ?? 0));
      const desired = maxParentCol + 1;
      const current = columnOf.get(id) ?? -1;
      if (desired > current) {
        columnOf.set(id, desired);
        changed = true;
      }
    }
  }

  for (const id of nodes.keys()) {
    if (!columnOf.has(id)) columnOf.set(id, 0);
  }

  // Step 2 — Build childrenOf and parentsOf
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();

  for (const [id, n] of nodes) {
    for (const child of n.children) {
      if (!childrenOf.has(id)) childrenOf.set(id, []);
      childrenOf.get(id)!.push(child);
      if (!parentsOf.has(child)) parentsOf.set(child, []);
      parentsOf.get(child)!.push(id);
    }
  }

  // Step 3 — Isolated vs connected nodes
  const connectedNames = new Set<string>();
  for (const [parentName, children] of childrenOf.entries()) {
    connectedNames.add(parentName);
    for (const c of children) connectedNames.add(c);
  }

  const isolatedNames = new Map<number, string[]>();
  for (const [id] of nodes) {
    if (!connectedNames.has(id)) {
      const col = columnOf.get(id) ?? 0;
      if (!isolatedNames.has(col)) isolatedNames.set(col, []);
      isolatedNames.get(col)!.push(id);
    }
  }

  // Group connected nodes by column
  const byColumn = new Map<number, string[]>();
  for (const [id, col] of columnOf.entries()) {
    if (!connectedNames.has(id)) continue;
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(id);
  }

  // Sort each column alphabetically for deterministic initial order
  for (const arr of byColumn.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }

  // Step 4 — Inner helpers
  function nodeHeight(id: string): number {
    return nodes.get(id)!.height;
  }

  function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
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
            if (nextIdealTop >= idealTop + h + NODE_GAP) tops[i] = idealTop;
          } else {
            tops[i] = idealTop;
          }
        } else {
          tops[i] = idealTop;
        }
      }
      if (tops[i] === undefined) tops[i] = currentBottom;
      currentBottom = tops[i] + h + NODE_GAP;
    }

    const yCenter = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      yCenter.set(orderedNames[i], tops[i] + nodeHeight(orderedNames[i]) / 2);
    }
    return yCenter;
  }

  function reorderColumn(col: number, yCenters: Map<string, number>): void {
    const names = byColumn.get(col);
    if (!names) return;

    const desiredY = new Map<string, number>();
    for (const name of names) {
      const neighbours: number[] = [];
      for (const p of parentsOf.get(name) ?? []) {
        if (columnOf.get(p) === col - 1 && yCenters.has(p))
          neighbours.push(yCenters.get(p)!);
      }
      for (const c of childrenOf.get(name) ?? []) {
        if (columnOf.get(c) === col + 1 && yCenters.has(c))
          neighbours.push(yCenters.get(c)!);
      }
      desiredY.set(
        name,
        neighbours.length > 0 ? median(neighbours) : (yCenters.get(name) ?? 0),
      );
    }

    const sorted = [...names].sort((a, b) => {
      const dy = (desiredY.get(a) ?? 0) - (desiredY.get(b) ?? 0);
      return dy !== 0 ? dy : a.localeCompare(b);
    });
    byColumn.set(col, sorted);

    const packed = packColumn(sorted, desiredY);
    for (const [name, yc] of packed.entries()) yCenters.set(name, yc);
  }

  // Step 5 — Main optimization loop (20-iteration sweep, forward+backward)
  const yCenters = new Map<string, number>();
  for (const names of byColumn.values()) {
    const packed = packColumn(names);
    for (const [name, yc] of packed.entries()) yCenters.set(name, yc);
  }

  const sortedCols = Array.from(byColumn.keys()).sort((a, b) => a - b);

  function computeCost(): number {
    let cost = 0;
    for (const [parentName, children] of childrenOf.entries()) {
      for (const childName of children) {
        if (yCenters.has(parentName) && yCenters.has(childName))
          cost += Math.abs(yCenters.get(parentName)! - yCenters.get(childName)!);
      }
    }
    return cost;
  }

  let prevCost = Infinity;
  for (let iter = 0; iter < 20; iter++) {
    for (const col of sortedCols) reorderColumn(col, yCenters);
    for (const col of [...sortedCols].reverse()) reorderColumn(col, yCenters);
    const currentCost = computeCost();
    if (currentCost === prevCost) break;
    prevCost = currentCost;
  }

  // Step 6 — Local improvement pass
  // Build a working tops map from yCenters
  const tops = new Map<string, number>();
  for (const [id, yc] of yCenters) {
    tops.set(id, yc - nodeHeight(id) / 2);
  }

  // Collect all connected node ids grouped by column
  const connectedByColumn = new Map<number, string[]>(
    Array.from(byColumn.entries()).map(([col, ids]) => [col, [...ids]]),
  );

  let anyMoved = true;
  while (anyMoved) {
    anyMoved = false;

    for (const col of sortedCols) {
      const colNodes = connectedByColumn.get(col);
      if (!colNodes || colNodes.length === 0) continue;

      // Sort by current top (ascending)
      colNodes.sort((a, b) => (tops.get(a) ?? 0) - (tops.get(b) ?? 0));

      for (let i = 0; i < colNodes.length; i++) {
        const id = colNodes[i];
        const h = nodeHeight(id);

        // Free range for this node's top
        const lo =
          i === 0
            ? 0
            : (tops.get(colNodes[i - 1])! + nodeHeight(colNodes[i - 1]) + NODE_GAP);
        const hi =
          i === colNodes.length - 1
            ? Infinity
            : (tops.get(colNodes[i + 1])! - h - NODE_GAP);

        if (lo > hi - 0.5) continue; // no room

        // Optimal center y = median of all connected-neighbor centers
        const neighborCenters: number[] = [
          ...(parentsOf.get(id) ?? []).map((p) => {
            const pt = tops.get(p);
            return pt !== undefined ? pt + nodeHeight(p) / 2 : null;
          }).filter((v): v is number => v !== null),
          ...(childrenOf.get(id) ?? []).map((c) => {
            const ct = tops.get(c);
            return ct !== undefined ? ct + nodeHeight(c) / 2 : null;
          }).filter((v): v is number => v !== null),
        ];

        if (neighborCenters.length === 0) continue; // isolated, don't move

        const targetCenter = median(neighborCenters);
        const targetTop = Math.max(lo, Math.min(hi === Infinity ? targetCenter - h / 2 : hi, targetCenter - h / 2));

        // Move only if it strictly decreases cost
        const oldTop = tops.get(id)!;
        const oldCenter = oldTop + h / 2;
        const newCenter = targetTop + h / 2;

        if (Math.abs(newCenter - oldCenter) < 0.5) continue;

        let costDelta = 0;
        for (const p of parentsOf.get(id) ?? []) {
          const pt = tops.get(p);
          if (pt === undefined) continue;
          const nc = pt + nodeHeight(p) / 2;
          costDelta += Math.abs(newCenter - nc) - Math.abs(oldCenter - nc);
        }
        for (const c of childrenOf.get(id) ?? []) {
          const ct = tops.get(c);
          if (ct === undefined) continue;
          const nc = ct + nodeHeight(c) / 2;
          costDelta += Math.abs(newCenter - nc) - Math.abs(oldCenter - nc);
        }

        if (costDelta < -0.5) {
          tops.set(id, targetTop);
          anyMoved = true;
        }
      }
    }
  }

  // Step 7 — Isolated node placement
  for (const [col, inames] of isolatedNames.entries()) {
    const connectedInCol = connectedByColumn.get(col) ?? [];
    let bottomY = 0;
    for (const name of connectedInCol) {
      const t = tops.get(name) ?? 0;
      const bottom = t + nodeHeight(name);
      if (bottom > bottomY) bottomY = bottom;
    }
    if (connectedInCol.length > 0) bottomY += NODE_GAP;

    let y = bottomY;
    for (const name of [...inames].sort((a, b) => a.localeCompare(b))) {
      tops.set(name, y);
      y += nodeHeight(name) + NODE_GAP;
    }
  }

  // Step 8 — Return top-y for each node
  return tops;
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

export function computeLayout(
  groups: GroupDetail[],
  onGroupSelect: (name: string, isVirtual?: boolean) => void,
  onMemberClick: (username: string) => void,
  heightOverrides: Map<string, number>,
): { nodes: GroupNodeType[]; edges: Edge[] } {
  const groupByName = new Map<string, GroupDetail>();
  for (const g of groups) groupByName.set(g.name, g);
  const uniqueGroups = Array.from(groupByName.values());

  const realGroups = uniqueGroups.filter((g) => !g.is_virtual);
  const virtualGroups = uniqueGroups.filter((g) => g.is_virtual);

  const allRealNames = new Set(realGroups.map((g) => g.name));

  // Build nodeInputs for computeNodeTops
  const nodeInputs = new Map<string, NodeInput>();

  // Build childrenOf from parent relationships
  const childrenOfReal = new Map<string, string[]>();
  for (const g of realGroups) {
    for (const parent of g.parents) {
      if (allRealNames.has(parent.name)) {
        if (!childrenOfReal.has(parent.name)) childrenOfReal.set(parent.name, []);
        childrenOfReal.get(parent.name)!.push(g.name);
      }
    }
  }

  for (const g of realGroups) {
    const parents = g.parents
      .filter((p) => allRealNames.has(p.name))
      .map((p) => p.name);
    const children = childrenOfReal.get(g.name) ?? [];
    const memberCount =
      g.members.leader.length +
      g.members.manager.length +
      g.members.member.length;
    const height =
      heightOverrides.get(g.name) ??
      (NODE_HEADER_HEIGHT + memberCount * NODE_MEMBER_ROW_HEIGHT + NODE_FOOTER_PAD);
    nodeInputs.set(g.name, { parents, children, height });
  }

  const topsMap = computeNodeTops(nodeInputs);

  // Re-derive column assignments for x positioning
  const columnOf = new Map<string, number>();
  for (const [id, n] of nodeInputs) {
    if (n.parents.length === 0) columnOf.set(id, 0);
  }
  let changedCol = true;
  while (changedCol) {
    changedCol = false;
    for (const [id, n] of nodeInputs) {
      if (n.parents.length === 0) continue;
      const maxParentCol = Math.max(...n.parents.map((p) => columnOf.get(p) ?? 0));
      const desired = maxParentCol + 1;
      const current = columnOf.get(id) ?? -1;
      if (desired > current) {
        columnOf.set(id, desired);
        changedCol = true;
      }
    }
  }
  for (const id of nodeInputs.keys()) {
    if (!columnOf.has(id)) columnOf.set(id, 0);
  }

  const nodes: GroupNodeType[] = realGroups.map((g) => {
    const col = columnOf.get(g.name) ?? 0;
    const yTop = topsMap.get(g.name) ?? 0;

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

  const memberCountOf = (g: GroupDetail) =>
    g.members.leader.length + g.members.manager.length + g.members.member.length;

  const maxY = realGroups.reduce((max, g) => {
    const yTop = topsMap.get(g.name) ?? 0;
    const measured = heightOverrides.get(g.name);
    const h =
      measured ??
      NODE_HEADER_HEIGHT + memberCountOf(g) * NODE_MEMBER_ROW_HEIGHT + NODE_FOOTER_PAD;
    return Math.max(max, yTop + h);
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
  }

  return { nodes, edges };
}
