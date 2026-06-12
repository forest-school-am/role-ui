import type { LayoutFn, NodeInput, NodePositions } from "./types";
import { COLUMN_WIDTH, NODE_GAP } from "./types";

// ---------------------------------------------------------------------------
// Column assignment (longest-path depth)
// ---------------------------------------------------------------------------

function assignColumns(nodes: Map<string, NodeInput>): Map<string, number> {
  const col = new Map<string, number>();
  for (const [id, n] of nodes) {
    if (n.parents.length === 0) col.set(id, 0);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, n] of nodes) {
      if (n.parents.length === 0) continue;
      const max = Math.max(...n.parents.map((p) => col.get(p) ?? 0));
      const desired = max + 1;
      if ((col.get(id) ?? -1) < desired) {
        col.set(id, desired);
        changed = true;
      }
    }
  }
  for (const id of nodes.keys()) {
    if (!col.has(id)) col.set(id, 0);
  }
  return col;
}

// ---------------------------------------------------------------------------
// Legacy median-sweep layout (kept for reference)
// ---------------------------------------------------------------------------

export function computeNodeTops(
  nodes: Map<string, NodeInput>,
): Map<string, number> {
  const columnOf = assignColumns(nodes);

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

  const connectedNames = new Set<string>();
  for (const [p, cs] of childrenOf) {
    connectedNames.add(p);
    for (const c of cs) connectedNames.add(c);
  }

  const isolatedNames = new Map<number, string[]>();
  for (const [id] of nodes) {
    if (!connectedNames.has(id)) {
      const c = columnOf.get(id) ?? 0;
      if (!isolatedNames.has(c)) isolatedNames.set(c, []);
      isolatedNames.get(c)!.push(id);
    }
  }

  const byColumn = new Map<number, string[]>();
  for (const [id, c] of columnOf) {
    if (!connectedNames.has(id)) continue;
    if (!byColumn.has(c)) byColumn.set(c, []);
    byColumn.get(c)!.push(id);
  }
  for (const arr of byColumn.values()) arr.sort((a, b) => a.localeCompare(b));

  function nodeHeight(id: string) { return nodes.get(id)!.height; }

  function median(values: number[]): number {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function packColumn(ordered: string[], desiredYCenters?: Map<string, number>): Map<string, number> {
    const tops: number[] = new Array(ordered.length);
    let bottom = 0;
    for (let i = 0; i < ordered.length; i++) {
      const name = ordered[i];
      const next = ordered[i + 1];
      const h = nodeHeight(name);
      const desired = desiredYCenters?.get(name);
      const ideal = desired !== undefined ? desired - h / 2 : bottom;
      if (ideal > bottom) {
        if (next !== undefined) {
          const nextIdeal = desiredYCenters?.get(next);
          if (nextIdeal !== undefined) {
            if (nextIdeal >= ideal + h + NODE_GAP) tops[i] = ideal;
          } else {
            tops[i] = ideal;
          }
        } else {
          tops[i] = ideal;
        }
      }
      if (tops[i] === undefined) tops[i] = bottom;
      bottom = tops[i] + h + NODE_GAP;
    }
    const yCenter = new Map<string, number>();
    for (let i = 0; i < ordered.length; i++) {
      yCenter.set(ordered[i], tops[i] + nodeHeight(ordered[i]) / 2);
    }
    return yCenter;
  }

  function reorderColumn(col: number, yCenters: Map<string, number>): void {
    const names = byColumn.get(col);
    if (!names) return;
    const desiredY = new Map<string, number>();
    for (const name of names) {
      const nb: number[] = [];
      for (const p of parentsOf.get(name) ?? [])
        if (columnOf.get(p) === col - 1 && yCenters.has(p)) nb.push(yCenters.get(p)!);
      for (const c of childrenOf.get(name) ?? [])
        if (columnOf.get(c) === col + 1 && yCenters.has(c)) nb.push(yCenters.get(c)!);
      desiredY.set(name, nb.length > 0 ? median(nb) : (yCenters.get(name) ?? 0));
    }
    const sorted = [...names].sort((a, b) => {
      const dy = (desiredY.get(a) ?? 0) - (desiredY.get(b) ?? 0);
      return dy !== 0 ? dy : a.localeCompare(b);
    });
    byColumn.set(col, sorted);
    const packed = packColumn(sorted, desiredY);
    for (const [n, yc] of packed) yCenters.set(n, yc);
  }

  const yCenters = new Map<string, number>();
  for (const names of byColumn.values()) {
    for (const [n, yc] of packColumn(names)) yCenters.set(n, yc);
  }
  const sortedCols = Array.from(byColumn.keys()).sort((a, b) => a - b);

  function computeCost(): number {
    let cost = 0;
    for (const [p, cs] of childrenOf)
      for (const c of cs)
        if (yCenters.has(p) && yCenters.has(c))
          cost += Math.abs(yCenters.get(p)! - yCenters.get(c)!);
    return cost;
  }

  let prevCost = Infinity;
  for (let iter = 0; iter < 20; iter++) {
    for (const col of sortedCols) reorderColumn(col, yCenters);
    for (const col of [...sortedCols].reverse()) reorderColumn(col, yCenters);
    const c = computeCost();
    if (c === prevCost) break;
    prevCost = c;
  }

  const tops = new Map<string, number>();
  for (const [id, yc] of yCenters) tops.set(id, yc - nodeHeight(id) / 2);

  const connectedByColumn = new Map<number, string[]>(
    Array.from(byColumn.entries()).map(([col, ids]) => [col, [...ids]]),
  );

  let anyMoved = true;
  while (anyMoved) {
    anyMoved = false;
    for (const col of sortedCols) {
      const colNodes = connectedByColumn.get(col);
      if (!colNodes?.length) continue;
      colNodes.sort((a, b) => (tops.get(a) ?? 0) - (tops.get(b) ?? 0));
      for (let i = 0; i < colNodes.length; i++) {
        const id = colNodes[i];
        const h = nodeHeight(id);
        const lo = i === 0 ? 0 : tops.get(colNodes[i - 1])! + nodeHeight(colNodes[i - 1]) + NODE_GAP;
        const hi = i === colNodes.length - 1 ? Infinity : tops.get(colNodes[i + 1])! - h - NODE_GAP;
        if (lo > hi - 0.5) continue;
        const nb: number[] = [
          ...(parentsOf.get(id) ?? []).map((p) => { const t = tops.get(p); return t !== undefined ? t + nodeHeight(p) / 2 : null; }).filter((v): v is number => v !== null),
          ...(childrenOf.get(id) ?? []).map((c) => { const t = tops.get(c); return t !== undefined ? t + nodeHeight(c) / 2 : null; }).filter((v): v is number => v !== null),
        ];
        if (!nb.length) continue;
        const target = median(nb);
        const targetTop = Math.max(lo, Math.min(hi === Infinity ? target - h / 2 : hi, target - h / 2));
        const oldTop = tops.get(id)!;
        const oldC = oldTop + h / 2;
        const newC = targetTop + h / 2;
        if (Math.abs(newC - oldC) < 0.5) continue;
        let delta = 0;
        for (const p of parentsOf.get(id) ?? []) {
          const t = tops.get(p); if (t === undefined) continue;
          const nc = t + nodeHeight(p) / 2;
          delta += Math.abs(newC - nc) - Math.abs(oldC - nc);
        }
        for (const c of childrenOf.get(id) ?? []) {
          const t = tops.get(c); if (t === undefined) continue;
          const nc = t + nodeHeight(c) / 2;
          delta += Math.abs(newC - nc) - Math.abs(oldC - nc);
        }
        if (delta < -0.5) { tops.set(id, targetTop); anyMoved = true; }
      }
    }
  }

  for (const [col, inames] of isolatedNames) {
    const conn = connectedByColumn.get(col) ?? [];
    let bottomY = 0;
    for (const n of conn) bottomY = Math.max(bottomY, (tops.get(n) ?? 0) + nodeHeight(n));
    if (conn.length) bottomY += NODE_GAP;
    let y = bottomY;
    for (const n of [...inames].sort((a, b) => a.localeCompare(b))) {
      tops.set(n, y);
      y += nodeHeight(n) + NODE_GAP;
    }
  }

  return tops;
}

// ---------------------------------------------------------------------------
// Spring-energy layout (primary)
// ---------------------------------------------------------------------------

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
    if ((inDegree.get(id) ?? 0) === 0) { railOf.set(id, 0); queue.push(id); }
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
  for (const id of nodes.keys()) if (!railOf.has(id)) railOf.set(id, 0);
  const railGroups = new Map<number, string[]>();
  for (const [id, r] of railOf) {
    if (!railGroups.has(r)) railGroups.set(r, []);
    railGroups.get(r)!.push(id);
  }
  for (const arr of railGroups.values()) arr.sort((a, b) => a.localeCompare(b));
  return { railOf, railGroups };
}

function solvePositionsGivenOrdering(
  nodes: Map<string, NodeInput>,
  railGroups: Map<number, string[]>,
): Map<string, number> {
  const nodeRail = new Map<string, number>();
  for (const [r, ids] of railGroups) for (const id of ids) nodeRail.set(id, r);

  const yCenters = new Map<string, number>();
  for (const [, rail] of railGroups) {
    let top = 0;
    for (const id of rail) {
      const h = nodes.get(id)!.height;
      yCenters.set(id, top + h / 2);
      top += h + NODE_GAP;
    }
  }

  function packRail(rail: string[], targets: Map<string, number>): void {
    let floor = 0;
    for (const id of rail) {
      const h = nodes.get(id)!.height;
      const center = Math.max(floor + h / 2, targets.get(id) ?? floor + h / 2);
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
        e += (yi - (yCenters.get(child) ?? 0)) ** 2;
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
        const nb = [...n.parents, ...n.children].filter(
          (j) => Math.abs((nodeRail.get(j) ?? col) - col) === 1,
        );
        targets.set(id, nb.length > 0
          ? nb.reduce((s, j) => s + (yCenters.get(j) ?? 0), 0) / nb.length
          : (yCenters.get(id) ?? 0));
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

function solveOrderingGivenPositions(
  railGroups: Map<number, string[]>,
  yCenters: Map<string, number>,
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (const [r, ids] of railGroups) {
    result.set(r, [...ids].sort((a, b) => {
      const dy = (yCenters.get(a) ?? 0) - (yCenters.get(b) ?? 0);
      return dy !== 0 ? dy : a.localeCompare(b);
    }));
  }
  return result;
}

/**
 * Spring-energy layout. Returns a tops map (top-y per node, no x).
 * Exported so perturbation tests can inspect the raw tops directly.
 */
export function computeNodeTopsNew(
  nodes: Map<string, NodeInput>,
): Map<string, number> {
  const { railGroups: initialRailGroups } = assignToRails(nodes);

  const connectedRailGroups = new Map<number, string[]>();
  const isolatedByRail = new Map<number, string[]>();
  for (const [r, ids] of initialRailGroups) {
    const conn: string[] = [], iso: string[] = [];
    for (const id of ids) {
      const n = nodes.get(id)!;
      (n.parents.length > 0 || n.children.length > 0 ? conn : iso).push(id);
    }
    if (conn.length) connectedRailGroups.set(r, conn);
    if (iso.length) isolatedByRail.set(r, iso);
  }

  let railGroups = connectedRailGroups;
  let yCenters = new Map<string, number>();

  for (let iter = 0; iter < 20; iter++) {
    yCenters = solvePositionsGivenOrdering(nodes, railGroups);
    const newRailGroups = solveOrderingGivenPositions(railGroups, yCenters);
    let changed = false;
    for (const [r, newOrder] of newRailGroups) {
      const old = railGroups.get(r) ?? [];
      if (newOrder.some((id, i) => id !== old[i])) { changed = true; break; }
    }
    railGroups = newRailGroups;
    if (!changed) break;
  }

  const tops = new Map<string, number>();
  for (const [id, yc] of yCenters) tops.set(id, yc - nodes.get(id)!.height / 2);

  function medianOf(values: number[]): number {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  const sortedRailEntries = Array.from(railGroups.entries()).sort(([a], [b]) => a - b);
  const nodeRailImprove = new Map<string, number>();
  for (const [r, ids] of railGroups) for (const id of ids) nodeRailImprove.set(id, r);

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
        const lo = i === 0 ? 0 : tops.get(colNodes[i - 1])! + nodes.get(colNodes[i - 1])!.height + NODE_GAP;
        const hi = i === colNodes.length - 1 ? Infinity : tops.get(colNodes[i + 1])! - h - NODE_GAP;
        if (lo > hi - 0.5) continue;
        const n = nodes.get(id)!;
        const nb: number[] = [
          ...n.parents.flatMap((p) => {
            if (Math.abs((nodeRailImprove.get(p) ?? myRail) - myRail) !== 1) return [];
            const t = tops.get(p); return t !== undefined ? [t + nodes.get(p)!.height / 2] : [];
          }),
          ...n.children.flatMap((c) => {
            if (Math.abs((nodeRailImprove.get(c) ?? myRail) - myRail) !== 1) return [];
            const t = tops.get(c); return t !== undefined ? [t + nodes.get(c)!.height / 2] : [];
          }),
        ];
        if (!nb.length) continue;

        const targetCenter = medianOf(nb);
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

        const medianTop = Math.max(lo, Math.min(hi === Infinity ? targetCenter - h / 2 : hi, targetCenter - h / 2));
        const medianDelta = Math.abs(medianTop - oldTop) < 0.5 ? 1 : costDeltaAt(medianTop);
        const hiTop = hi === Infinity ? medianTop : hi;
        const hiDelta = (hi === Infinity || Math.abs(hiTop - oldTop) < 0.5) ? 1 : costDeltaAt(hiTop);
        const bestDelta = Math.min(medianDelta, hiDelta);
        if (bestDelta < 1e-9) {
          tops.set(id, medianDelta <= hiDelta ? medianTop : hiTop);
          anyMoved = true;
        }
      }
    }
  }

  for (const [r, isoIds] of isolatedByRail) {
    const connIds = railGroups.get(r) ?? [];
    let bottomY = 0;
    for (const id of connIds) bottomY = Math.max(bottomY, (tops.get(id) ?? 0) + nodes.get(id)!.height);
    if (connIds.length) bottomY += NODE_GAP;
    let y = bottomY;
    for (const id of [...isoIds].sort((a, b) => a.localeCompare(b))) {
      tops.set(id, y);
      y += nodes.get(id)!.height + NODE_GAP;
    }
  }

  return tops;
}

/**
 * Full LayoutFn: spring-energy tops + column-based x assignment.
 */
export const springLayout: LayoutFn = (nodes) => {
  const tops = computeNodeTopsNew(nodes);
  const col = assignColumns(nodes);
  const positions: NodePositions = new Map();
  for (const [id] of nodes) {
    positions.set(id, { x: (col.get(id) ?? 0) * COLUMN_WIDTH, y: tops.get(id) ?? 0 });
  }
  return positions;
};
