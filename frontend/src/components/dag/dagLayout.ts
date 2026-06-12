import { MarkerType, type Edge } from "@xyflow/react";
import { graphStratify, sugiyama, type GraphNode } from "d3-dag";
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
// Spring-energy layout (computeNodeTopsNew)
// ---------------------------------------------------------------------------

/**
 * Step 1 — Assign each node to a rail equal to its longest-path depth in the DAG.
 * Roots (no parents present in the node set) go to rail 0.
 *
 * Uses Kahn's BFS: track how many in-set parents each node is still waiting
 * for.  A node is enqueued only once that counter reaches zero, so when it is
 * dequeued its depth is already the true maximum over all parent paths — O(V + E).
 */
function assignToRails(nodes: Map<string, NodeInput>): {
  railOf: Map<string, number>;
  railGroups: Map<number, string[]>;
} {
  const inDegree = new Map<string, number>();
  for (const [id, n] of nodes) {
    inDegree.set(id, n.parents.filter((p) => nodes.has(p)).length);
  }

  const railOf = new Map<string, number>();
  const queue: string[] = [];

  for (const [id] of nodes) {
    if ((inDegree.get(id) ?? 0) === 0) {
      railOf.set(id, 0);
      queue.push(id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const depth = railOf.get(id)!;
    for (const child of nodes.get(id)!.children) {
      if (!nodes.has(child)) continue;
      railOf.set(child, Math.max(railOf.get(child) ?? 0, depth + 1));
      const remaining = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, remaining);
      if (remaining === 0) queue.push(child);
    }
  }

  // Fallback for nodes in cycles or otherwise unreachable from any root.
  for (const id of nodes.keys()) {
    if (!railOf.has(id)) railOf.set(id, 0);
  }

  const railGroups = new Map<number, string[]>();
  for (const [id, rail] of railOf) {
    if (!railGroups.has(rail)) railGroups.set(rail, []);
    railGroups.get(rail)!.push(id);
  }
  for (const arr of railGroups.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }

  return { railOf, railGroups };
}

/**
 * Step 2 — Given a fixed top-to-bottom ordering on each rail, find y-center
 * positions that minimise Σ(y_i − y_j)² over all DAG edges (i, j) where
 * |rail(i) − rail(j)| = 1, subject to non-overlap constraints within each
 * rail.  Only neighbouring-rail springs are used; skip-rail edges (dx > 1)
 * do not contribute forces so they don't pull a column toward distant
 * ancestors.
 *
 * Each iteration sweeps columns left→right then right→left.  Within a column
 * every node's target is set to the mean y-center of its adjacent-rail spring
 * neighbours, then the rail is packed with that target while enforcing the
 * minimum-gap ordering constraint.  Sweeps repeat until the squared-distance
 * energy stops improving.
 */
function solvePositionsGivenOrdering(
  nodes: Map<string, NodeInput>,
  railGroups: Map<number, string[]>,
): Map<string, number> {
  function nodeHeight(id: string): number {
    return nodes.get(id)!.height;
  }

  // Build node → rail lookup for the adjacency filter.
  const nodeRail = new Map<string, number>();
  for (const [rail, ids] of railGroups) {
    for (const id of ids) nodeRail.set(id, rail);
  }

  // Initialise: stack each rail compactly from y = 0.
  const yCenters = new Map<string, number>();
  for (const [, rail] of railGroups) {
    let top = 0;
    for (const id of rail) {
      const h = nodeHeight(id);
      yCenters.set(id, top + h / 2);
      top += h + NODE_GAP;
    }
  }

  // Pack a rail (top-to-bottom order) toward per-node target centers.
  // A node sits at its target when the target is at or below the forced
  // minimum; otherwise it is pushed down to the minimum imposed by the
  // node above it.
  function packRail(rail: string[], targets: Map<string, number>): void {
    let floor = 0; // minimum top-y for the current node
    for (const id of rail) {
      const h = nodeHeight(id);
      const target = targets.get(id) ?? floor + h / 2;
      const center = Math.max(floor + h / 2, target);
      yCenters.set(id, center);
      floor = center + h / 2 + NODE_GAP;
    }
  }

  function springEnergy(): number {
    let e = 0;
    for (const [id, n] of nodes) {
      const ri = nodeRail.get(id) ?? 0;
      const yi = yCenters.get(id) ?? 0;
      for (const child of n.children) {
        if ((nodeRail.get(child) ?? 0) !== ri + 1) continue;
        const yj = yCenters.get(child) ?? 0;
        e += (yi - yj) ** 2;
      }
    }
    return e;
  }

  const sortedCols = Array.from(railGroups.keys()).sort((a, b) => a - b);

  function sweepColumns(cols: number[]): void {
    for (const col of cols) {
      const rail = railGroups.get(col)!;
      const targets = new Map<string, number>();
      for (const id of rail) {
        const n = nodes.get(id)!;
        // Only include neighbours on immediately adjacent rails.
        const nb = [...n.parents, ...n.children].filter(
          (j) => Math.abs((nodeRail.get(j) ?? col) - col) === 1,
        );
        targets.set(
          id,
          nb.length > 0
            ? nb.reduce((s, j) => s + (yCenters.get(j) ?? 0), 0) / nb.length
            : (yCenters.get(id) ?? 0),
        );
      }
      packRail(rail, targets);
    }
  }

  let prevEnergy = Infinity;
  for (let iter = 0; iter < 50; iter++) {
    sweepColumns(sortedCols);
    sweepColumns([...sortedCols].reverse());
    const e = springEnergy();
    if (Math.abs(e - prevEnergy) < 0.01) break;
    prevEnergy = e;
  }

  return yCenters;
}

/**
 * Step 3 — Re-sort each rail by ascending y-center (ties broken
 * alphabetically), returning the updated ordering.
 */
function solveOrderingGivenPositions(
  railGroups: Map<number, string[]>,
  yCenters: Map<string, number>,
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (const [rail, ids] of railGroups) {
    result.set(
      rail,
      [...ids].sort((a, b) => {
        const dy = (yCenters.get(a) ?? 0) - (yCenters.get(b) ?? 0);
        return dy !== 0 ? dy : a.localeCompare(b);
      }),
    );
  }
  return result;
}

/**
 * Spring-energy alternative to computeNodeTops.
 *
 * 1. assignToRails                — place each node on a rail by DAG depth.
 * 2. Loop until ordering stabilises (up to 20 outer iterations):
 *    a. solvePositionsGivenOrdering — slide nodes to minimise spring energy.
 *    b. solveOrderingGivenPositions — re-sort each rail by current y-center.
 * 3. Append isolated nodes (no DAG edges) at the bottom of their rail.
 */
export function computeNodeTopsNew(
  nodes: Map<string, NodeInput>,
): Map<string, number> {
  const { railGroups: initialRailGroups } = assignToRails(nodes);

  const connectedRailGroups = new Map<number, string[]>();
  const isolatedByRail = new Map<number, string[]>();

  for (const [rail, ids] of initialRailGroups) {
    const connected: string[] = [];
    const isolated: string[] = [];
    for (const id of ids) {
      const n = nodes.get(id)!;
      if (n.parents.length > 0 || n.children.length > 0) connected.push(id);
      else isolated.push(id);
    }
    if (connected.length > 0) connectedRailGroups.set(rail, connected);
    if (isolated.length > 0) isolatedByRail.set(rail, isolated);
  }

  let railGroups = connectedRailGroups;
  let yCenters = new Map<string, number>();

  for (let iter = 0; iter < 20; iter++) {
    yCenters = solvePositionsGivenOrdering(nodes, railGroups);
    const newRailGroups = solveOrderingGivenPositions(railGroups, yCenters);

    let orderingChanged = false;
    for (const [rail, newOrder] of newRailGroups) {
      const oldOrder = railGroups.get(rail) ?? [];
      if (newOrder.some((id, i) => id !== oldOrder[i])) {
        orderingChanged = true;
        break;
      }
    }
    railGroups = newRailGroups;
    if (!orderingChanged) break;
  }

  const tops = new Map<string, number>();
  for (const [id, yc] of yCenters) {
    tops.set(id, yc - nodes.get(id)!.height / 2);
  }

  // Local improvement pass — same absolute-distance fine-tuning as computeNodeTops.
  // Moves each node within its available gap toward the median of its neighbours'
  // centres, accepting only moves that strictly decrease Σ|Δy|.  Repeats until
  // no node moves (guaranteed to converge).
  function medianOf(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const sortedRailEntries = Array.from(railGroups.entries()).sort(([a], [b]) => a - b);

  // Rail lookup for the local improvement pass adjacency filter.
  const nodeRailImprove = new Map<string, number>();
  for (const [rail, ids] of railGroups) {
    for (const id of ids) nodeRailImprove.set(id, rail);
  }

  // Accept moves that are neutral (costDelta ≤ 0) — a neutral move may create
  // room for a neighbour to make an improving move in the next pass.
  // Only adjacent-rail edges (dx = 1) are counted, matching the spring objective.
  // Cap at 2000 passes to guarantee termination.
  let anyMoved = true;
  let passLimit = 2000;
  while (anyMoved && passLimit-- > 0) {
    anyMoved = false;
    for (const [, rail] of sortedRailEntries) {
      const colNodes = [...rail].sort((a, b) => (tops.get(a) ?? 0) - (tops.get(b) ?? 0));
      for (let i = 0; i < colNodes.length; i++) {
        const id = colNodes[i];
        const h = nodes.get(id)!.height;
        const myRail = nodeRailImprove.get(id) ?? 0;
        const lo =
          i === 0
            ? 0
            : (tops.get(colNodes[i - 1])! + nodes.get(colNodes[i - 1])!.height + NODE_GAP);
        const hi =
          i === colNodes.length - 1
            ? Infinity
            : (tops.get(colNodes[i + 1])! - h - NODE_GAP);
        if (lo > hi - 0.5) continue;

        const n = nodes.get(id)!;
        const neighborCenters: number[] = [
          ...n.parents.flatMap((p) => {
            if (Math.abs((nodeRailImprove.get(p) ?? myRail) - myRail) !== 1) return [];
            const t = tops.get(p);
            return t !== undefined ? [t + nodes.get(p)!.height / 2] : [];
          }),
          ...n.children.flatMap((c) => {
            if (Math.abs((nodeRailImprove.get(c) ?? myRail) - myRail) !== 1) return [];
            const t = tops.get(c);
            return t !== undefined ? [t + nodes.get(c)!.height / 2] : [];
          }),
        ];
        if (neighborCenters.length === 0) continue;

        const targetCenter = medianOf(neighborCenters);
        const oldTop = tops.get(id)!;
        const oldCenter = oldTop + h / 2;

        function costDeltaAt(newTop: number): number {
          const newC = newTop + h / 2;
          let d = 0;
          for (const p of n.parents) {
            if (Math.abs((nodeRailImprove.get(p) ?? myRail) - myRail) !== 1) continue;
            const t = tops.get(p); if (t === undefined) continue;
            const nc = t + nodes.get(p)!.height / 2;
            d += Math.abs(newC - nc) - Math.abs(oldCenter - nc);
          }
          for (const c of n.children) {
            if (Math.abs((nodeRailImprove.get(c) ?? myRail) - myRail) !== 1) continue;
            const t = tops.get(c); if (t === undefined) continue;
            const nc = t + nodes.get(c)!.height / 2;
            d += Math.abs(newC - nc) - Math.abs(oldCenter - nc);
          }
          return d;
        }

        // Primary candidate: clamped median target.
        const medianTop = Math.max(lo, Math.min(hi === Infinity ? targetCenter - h / 2 : hi, targetCenter - h / 2));
        const medianDelta = Math.abs(medianTop - oldTop) < 0.5 ? 1 : costDeltaAt(medianTop);

        // Secondary candidate: slide to hi (maximum allowed position).
        // Moving toward hi frees space above the node for upper neighbours.
        const hiTop = hi === Infinity ? medianTop : hi;
        const hiDelta = (hi === Infinity || Math.abs(hiTop - oldTop) < 0.5) ? 1 : costDeltaAt(hiTop);

        // Accept the best candidate that does not increase cost.
        const bestDelta = Math.min(medianDelta, hiDelta);
        if (bestDelta < 1e-9) {
          const finalTop = medianDelta <= hiDelta ? medianTop : hiTop;
          tops.set(id, finalTop);
          anyMoved = true;
        }
      }
    }
  }

  for (const [rail, isoIds] of isolatedByRail) {
    const connIds = railGroups.get(rail) ?? [];
    let bottomY = 0;
    for (const id of connIds) {
      bottomY = Math.max(bottomY, (tops.get(id) ?? 0) + nodes.get(id)!.height);
    }
    if (connIds.length > 0) bottomY += NODE_GAP;

    let y = bottomY;
    for (const id of [...isoIds].sort((a, b) => a.localeCompare(b))) {
      tops.set(id, y);
      y += nodes.get(id)!.height + NODE_GAP;
    }
  }

  return tops;
}

// ---------------------------------------------------------------------------
// d3-dag Sugiyama layout
// ---------------------------------------------------------------------------

export type LayoutAlgorithm = "spring" | "sugiyama";

type StratifyDatum = { id: string; parentIds: string[] };

/**
 * Use d3-dag's Sugiyama algorithm to lay out nodes.
 *
 * d3-dag is top-to-bottom by default; we rotate 90° by swapping x↔y:
 *   nodeSize[0] = within-layer spread  → becomes React Flow y (varies per node)
 *   nodeSize[1] = between-layer depth  → becomes React Flow x (= COLUMN_WIDTH)
 *
 * Returned map contains top-left React Flow positions.
 */
function computePositionsDag(
  nodes: Map<string, NodeInput>,
): Map<string, { x: number; y: number }> {
  const nodeData: StratifyDatum[] = Array.from(nodes.entries()).map(
    ([id, n]) => ({
      id,
      parentIds: n.parents.filter((p) => nodes.has(p)),
    }),
  );

  const graph = graphStratify()(nodeData);

  const sizeOf = (
    n: GraphNode<StratifyDatum, unknown>,
  ): readonly [number, number] => {
    const h = nodes.get(n.data.id)?.height ?? 60;
    // [within-layer spread, between-layer depth]
    return [h + NODE_GAP, COLUMN_WIDTH];
  };

  const layout = sugiyama().nodeSize(sizeOf).gap([0, 0]);
  layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes()) {
    const id = node.data.id;
    const h = nodes.get(id)?.height ?? 60;
    positions.set(id, {
      x: node.y - COLUMN_WIDTH / 2, // between-layer axis → React Flow x
      y: node.x - h / 2,            // within-layer axis  → React Flow y
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

export function computeLayout(
  groups: GroupDetail[],
  onGroupSelect: (name: string, isVirtual?: boolean) => void,
  onMemberClick: (username: string) => void,
  heightOverrides: Map<string, number>,
  algorithm: LayoutAlgorithm = "spring",
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

  // Compute node positions based on the chosen algorithm.
  let nodePositions: Map<string, { x: number; y: number }>;

  if (algorithm === "sugiyama") {
    nodePositions = computePositionsDag(nodeInputs);
  } else {
    // Spring layout: existing column + computeNodeTopsNew approach.
    const topsMap = computeNodeTopsNew(nodeInputs);
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
        if (desired > current) { columnOf.set(id, desired); changedCol = true; }
      }
    }
    for (const id of nodeInputs.keys()) {
      if (!columnOf.has(id)) columnOf.set(id, 0);
    }
    nodePositions = new Map();
    for (const [id] of nodeInputs) {
      nodePositions.set(id, {
        x: (columnOf.get(id) ?? 0) * COLUMN_WIDTH,
        y: topsMap.get(id) ?? 0,
      });
    }
  }

  const nodes: GroupNodeType[] = realGroups.map((g) => {
    const { x: xPos, y: yTop } = nodePositions.get(g.name) ?? { x: 0, y: 0 };

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
      position: { x: xPos, y: yTop },
      data,
    };
  });

  const memberCountOf = (g: GroupDetail) =>
    g.members.leader.length + g.members.manager.length + g.members.member.length;

  const maxY = realGroups.reduce((max, g) => {
    const yTop = nodePositions.get(g.name)?.y ?? 0;
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
