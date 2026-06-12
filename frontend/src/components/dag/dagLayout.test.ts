import { describe, it, expect } from 'vitest';
import { springLayout, computeNodeTopsNew, COLUMN_WIDTH, NODE_GAP } from './layouts';
import type { NodeInput, NodePositions } from './layouts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colOf(positions: NodePositions, id: string): number {
  const x = positions.get(id)?.x;
  if (x === undefined) throw new Error(`No position for "${id}"`);
  return Math.round(x / COLUMN_WIDTH);
}

function noOverlap(positions: NodePositions, inputs: Map<string, NodeInput>, col: number): boolean {
  const inCol = [...inputs.entries()]
    .filter(([id]) => colOf(positions, id) === col)
    .sort(([a], [b]) => (positions.get(a)?.y ?? 0) - (positions.get(b)?.y ?? 0));
  return inCol.every(([id], i) => {
    if (i === 0) return true;
    const [prevId, prevN] = inCol[i - 1];
    return (positions.get(id)?.y ?? 0) >= (positions.get(prevId)?.y ?? 0) + prevN.height;
  });
}

// ---------------------------------------------------------------------------
// Helper: computeColumnsFromInputs (used by perturbationCheck)
// ---------------------------------------------------------------------------

function computeColumnsFromInputs(inputs: Map<string, NodeInput>): Map<string, number> {
  const col = new Map<string, number>();
  for (const [id, n] of inputs) {
    if (n.parents.length === 0) col.set(id, 0);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, n] of inputs) {
      if (n.parents.length === 0) continue;
      const maxParentCol = Math.max(...n.parents.map(p => col.get(p) ?? 0));
      const desired = maxParentCol + 1;
      const current = col.get(id) ?? -1;
      if (desired > current) { col.set(id, desired); changed = true; }
    }
  }
  for (const id of inputs.keys()) {
    if (!col.has(id)) col.set(id, 0);
  }
  return col;
}

// ---------------------------------------------------------------------------
// Helper: seeded PRNG
// ---------------------------------------------------------------------------

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Helper: makeRandomDag
// ---------------------------------------------------------------------------

function makeRandomDag(n: number, seed: number): Map<string, NodeInput> {
  const rng = makePrng(seed);
  const levels: number[] = Array.from({ length: n }, (_, i) =>
    i === 0 ? 0 : Math.floor(rng() * 4),
  );
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => levels[a] - levels[b]);
  const ids = order.map((i) => `n${i}`);
  const nodeLevel = new Map(ids.map((id, idx) => [id, levels[order[idx]]]));

  const inputs = new Map<string, NodeInput>();
  for (const id of ids) {
    inputs.set(id, { parents: [], children: [], height: Math.floor(rng() * 150) + 50 });
  }
  for (const id of ids) {
    const lv = nodeLevel.get(id)!;
    if (lv === 0) continue;
    const candidates = ids.filter((o) => (nodeLevel.get(o) ?? 0) < lv);
    if (!candidates.length) continue;
    const numParents = Math.min(candidates.length, 1 + Math.floor(rng() * 2));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (let k = 0; k < numParents; k++) {
      const parent = candidates[k];
      inputs.get(id)!.parents.push(parent);
      inputs.get(parent)!.children.push(id);
    }
  }
  return inputs;
}

// ---------------------------------------------------------------------------
// Helper: perturbationCheck
// ---------------------------------------------------------------------------

function perturbationCheck(
  inputs: Map<string, NodeInput>,
  tops: Map<string, number>,
): void {
  const ITERATIONS = 100;
  const RING_SIZE = 20;

  const columnOf = computeColumnsFromInputs(inputs);

  const byColumn = new Map<number, string[]>();
  for (const [id, col] of columnOf) {
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(id);
  }
  for (const arr of byColumn.values()) arr.sort((a, b) => (tops.get(a) ?? 0) - (tops.get(b) ?? 0));

  const t = new Map(tops);
  function center(id: string): number { return (t.get(id) ?? 0) + inputs.get(id)!.height / 2; }

  const edges: [string, string][] = [];
  for (const [id, n] of inputs) {
    for (const child of n.children) {
      if (Math.abs((columnOf.get(id) ?? 0) - (columnOf.get(child) ?? 0)) === 1) {
        edges.push([id, child]);
      }
    }
  }

  function sumDeltaY(): number {
    let s = 0;
    for (const [p, c] of edges) s += Math.abs(center(p) - center(c));
    return s;
  }

  const originalSum = sumDeltaY();

  const ring: (string | null)[] = new Array(RING_SIZE).fill(null);
  const marked = new Set<string>();
  let ringPos = 0;
  function markNode(id: string) {
    const evicted = ring[ringPos % RING_SIZE];
    if (evicted !== null) marked.delete(evicted);
    ring[ringPos % RING_SIZE] = id;
    marked.add(id);
    ringPos++;
  }

  function costDeltaForMove(id: string, oldTop: number, newTop: number): number {
    const h = inputs.get(id)!.height;
    const oldC = oldTop + h / 2;
    const newC = newTop + h / 2;
    const col = columnOf.get(id) ?? 0;
    let delta = 0;
    for (const pid of inputs.get(id)!.parents) {
      if (Math.abs((columnOf.get(pid) ?? 0) - col) !== 1) continue;
      const nc = center(pid);
      delta += Math.abs(newC - nc) - Math.abs(oldC - nc);
    }
    for (const cid of inputs.get(id)!.children) {
      if (Math.abs((columnOf.get(cid) ?? 0) - col) !== 1) continue;
      const nc = center(cid);
      delta += Math.abs(newC - nc) - Math.abs(oldC - nc);
    }
    return delta;
  }

  const rng = makePrng(42);
  let currentSum = originalSum;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    interface Gap {
      col: number; aboveId: string; belowId: string;
      gapSize: number; aboveBottom: number;
    }
    const gaps: Gap[] = [];
    for (const [col, ids] of byColumn) {
      ids.sort((a, b) => (t.get(a) ?? 0) - (t.get(b) ?? 0));
      for (let i = 0; i < ids.length - 1; i++) {
        const a = ids[i], b = ids[i + 1];
        const aBottom = (t.get(a) ?? 0) + inputs.get(a)!.height;
        const bTop = t.get(b) ?? 0;
        const gapSize = bTop - aBottom - NODE_GAP;
        if (gapSize > 1) gaps.push({ col, aboveId: a, belowId: b, gapSize, aboveBottom: aBottom });
      }
    }
    if (!gaps.length) break;

    const gap = gaps[Math.floor(rng() * gaps.length)];
    const candidates: string[] = [];
    if (!marked.has(gap.aboveId)) candidates.push(gap.aboveId);
    if (!marked.has(gap.belowId)) candidates.push(gap.belowId);
    if (!candidates.length) continue;

    const id = candidates[Math.floor(rng() * candidates.length)];
    const isAbove = id === gap.aboveId;
    const maxMove = gap.gapSize;
    if (maxMove < 1) continue;
    const moveAmount = rng() * maxMove;
    if (moveAmount < 0.5) continue;

    const oldTop = t.get(id)!;
    const newTop = isAbove ? oldTop + moveAmount : oldTop - moveAmount;
    const delta = costDeltaForMove(id, oldTop, newTop);
    t.set(id, newTop);
    currentSum += delta;
    markNode(id);

    if (currentSum < originalSum - 0.5) {
      throw new Error(
        `Perturbation test failed: layout improved from ${originalSum.toFixed(2)} to ${currentSum.toFixed(2)} ` +
        `by moving "${id}" ${isAbove ? 'down' : 'up'} by ${moveAmount.toFixed(1)}px in iteration ${iter}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Structural tests — spring layout column assignments and no-overlap
// ---------------------------------------------------------------------------

describe('springLayout', () => {
  it('single node — at x=0', () => {
    const inputs = new Map<string, NodeInput>([
      ['A', { parents: [], children: [], height: 60 }],
    ]);
    const pos = springLayout(inputs);
    expect(colOf(pos, 'A')).toBe(0);
  });

  it('linear chain A→B→C — columns 0,1,2', () => {
    const inputs = new Map<string, NodeInput>([
      ['A', { parents: [],    children: ['B'], height: 60 }],
      ['B', { parents: ['A'], children: ['C'], height: 60 }],
      ['C', { parents: ['B'], children: [],    height: 60 }],
    ]);
    const pos = springLayout(inputs);
    expect(colOf(pos, 'A')).toBe(0);
    expect(colOf(pos, 'B')).toBe(1);
    expect(colOf(pos, 'C')).toBe(2);
  });

  it('balanced binary tree depth 2 — root col 0, children col 1, no overlap', () => {
    const inputs = new Map<string, NodeInput>([
      ['R',  { parents: [],    children: ['L', 'Rr'], height: 60 }],
      ['L',  { parents: ['R'], children: [],           height: 60 }],
      ['Rr', { parents: ['R'], children: [],           height: 60 }],
    ]);
    const pos = springLayout(inputs);
    expect(colOf(pos, 'R')).toBe(0);
    expect(colOf(pos, 'L')).toBe(1);
    expect(colOf(pos, 'Rr')).toBe(1);
    expect(noOverlap(pos, inputs, 1)).toBe(true);
  });

  it('balanced binary tree depth 3 — correct columns, no overlap in any column', () => {
    const inputs = new Map<string, NodeInput>([
      ['Root', { parents: [],       children: ['C1','C2'],      height: 60 }],
      ['C1',   { parents: ['Root'], children: ['G1','G2'],      height: 80 }],
      ['C2',   { parents: ['Root'], children: ['G3','G4'],      height: 80 }],
      ['G1',   { parents: ['C1'],   children: [],               height: 60 }],
      ['G2',   { parents: ['C1'],   children: [],               height: 60 }],
      ['G3',   { parents: ['C2'],   children: [],               height: 60 }],
      ['G4',   { parents: ['C2'],   children: [],               height: 60 }],
    ]);
    const pos = springLayout(inputs);
    expect(colOf(pos, 'Root')).toBe(0);
    expect(colOf(pos, 'C1')).toBe(1);
    expect(colOf(pos, 'C2')).toBe(1);
    expect([0,1,2].every((c) => noOverlap(pos, inputs, c))).toBe(true);
  });

  it('inverted binary tree — 4 leaves col 0, 2 mid col 1, apex col 2, no overlap', () => {
    const inputs = new Map<string, NodeInput>([
      ['D', { parents: [],          children: ['B'],    height: 60 }],
      ['E', { parents: [],          children: ['B'],    height: 60 }],
      ['F', { parents: [],          children: ['C'],    height: 60 }],
      ['G', { parents: [],          children: ['C'],    height: 60 }],
      ['B', { parents: ['D','E'],   children: ['A'],    height: 80 }],
      ['C', { parents: ['F','G'],   children: ['A'],    height: 80 }],
      ['A', { parents: ['B','C'],   children: [],       height: 60 }],
    ]);
    const pos = springLayout(inputs);
    expect(colOf(pos, 'D')).toBe(0);
    expect(colOf(pos, 'A')).toBe(2);
    expect([0,1,2].every((c) => noOverlap(pos, inputs, c))).toBe(true);
  });

  it('diamond A0,B0→M→C2,D2 — M at col 1, no overlap', () => {
    const inputs = new Map<string, NodeInput>([
      ['A0', { parents: [],          children: ['M'],      height: 70  }],
      ['B0', { parents: [],          children: ['M'],      height: 110 }],
      ['M',  { parents: ['A0','B0'], children: ['C2','D2'], height: 80 }],
      ['C2', { parents: ['M'],       children: [],          height: 60 }],
      ['D2', { parents: ['M'],       children: [],          height: 130 }],
    ]);
    const pos = springLayout(inputs);
    expect(colOf(pos, 'A0')).toBe(0);
    expect(colOf(pos, 'M')).toBe(1);
    expect(colOf(pos, 'C2')).toBe(2);
    expect([0,1,2].every((c) => noOverlap(pos, inputs, c))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Local optimality — perturbation tests
// ---------------------------------------------------------------------------

describe('computeNodeTopsNew — local optimality (perturbation test)', () => {
  it('chain of 5 nodes', () => {
    const inputs = new Map<string, NodeInput>([
      ['a', { parents: [],    children: ['b'], height: 80 }],
      ['b', { parents: ['a'], children: ['c'], height: 60 }],
      ['c', { parents: ['b'], children: ['d'], height: 100 }],
      ['d', { parents: ['c'], children: ['e'], height: 70 }],
      ['e', { parents: ['d'], children: [],    height: 90 }],
    ]);
    perturbationCheck(inputs, computeNodeTopsNew(inputs));
  });

  it('balanced binary tree depth 3', () => {
    const inputs = new Map<string, NodeInput>([
      ['root', { parents: [],       children: ['c1','c2'],  height: 60  }],
      ['c1',   { parents: ['root'], children: ['g1','g2'],  height: 80  }],
      ['c2',   { parents: ['root'], children: ['g3','g4'],  height: 80  }],
      ['g1',   { parents: ['c1'],   children: [],           height: 120 }],
      ['g2',   { parents: ['c1'],   children: [],           height: 50  }],
      ['g3',   { parents: ['c2'],   children: [],           height: 90  }],
      ['g4',   { parents: ['c2'],   children: [],           height: 70  }],
    ]);
    perturbationCheck(inputs, computeNodeTopsNew(inputs));
  });

  it('inverted binary tree', () => {
    const inputs = new Map<string, NodeInput>([
      ['d', { parents: [],       children: ['b'], height: 60  }],
      ['e', { parents: [],       children: ['b'], height: 90  }],
      ['f', { parents: [],       children: ['c'], height: 75  }],
      ['g', { parents: [],       children: ['c'], height: 55  }],
      ['b', { parents: ['d','e'], children: ['a'], height: 100 }],
      ['c', { parents: ['f','g'], children: ['a'], height: 80  }],
      ['a', { parents: ['b','c'], children: [],    height: 65  }],
    ]);
    perturbationCheck(inputs, computeNodeTopsNew(inputs));
  });

  it('diamond + extensions', () => {
    const inputs = new Map<string, NodeInput>([
      ['a0', { parents: [],          children: ['m'],       height: 70  }],
      ['b0', { parents: [],          children: ['m'],       height: 110 }],
      ['m',  { parents: ['a0','b0'], children: ['c2','d2'], height: 80  }],
      ['c2', { parents: ['m'],       children: [],          height: 60  }],
      ['d2', { parents: ['m'],       children: [],          height: 130 }],
    ]);
    perturbationCheck(inputs, computeNodeTopsNew(inputs));
  });

  for (const seed of [1, 7, 42, 137, 999]) {
    it(`random 10-node DAG seed=${seed}`, () => {
      const inputs = makeRandomDag(10, seed);
      perturbationCheck(inputs, computeNodeTopsNew(inputs));
    });
  }

  it('live authentik graph — full 16-group structure', () => {
    const inputs = new Map<string, NodeInput>([
      ['Bomgineering',        { parents: [],                              children: ['Platform','Growth','Marketing','C'], height: 146 }],
      ['A',                   { parents: [],                              children: ['H','I'],                             height: 74  }],
      ['B',                   { parents: [],                              children: [],                                    height: 74  }],
      ['authentik Admins',    { parents: [],                              children: [],                                    height: 122 }],
      ['authentik Read-only', { parents: [],                              children: [],                                    height: 50  }],
      ['Platform',            { parents: ['Bomgineering'],                children: ['F','G'],                             height: 146 }],
      ['Marketing',           { parents: ['Bomgineering'],                children: ['Growth'],                            height: 122 }],
      ['C',                   { parents: ['Bomgineering'],                children: ['D','E','G'],                         height: 122 }],
      ['H',                   { parents: ['A'],                           children: [],                                    height: 74  }],
      ['I',                   { parents: ['A'],                           children: ['D','DevOps'],                        height: 74  }],
      ['F',                   { parents: ['Platform'],                    children: [],                                    height: 74  }],
      ['G',                   { parents: ['Platform','C'],                children: [],                                    height: 74  }],
      ['Growth',              { parents: ['Bomgineering','Marketing'],    children: [],                                    height: 122 }],
      ['D',                   { parents: ['C','I'],                       children: [],                                    height: 74  }],
      ['E',                   { parents: ['C'],                           children: [],                                    height: 74  }],
      ['DevOps',              { parents: ['I'],                           children: [],                                    height: 146 }],
    ]);
    perturbationCheck(inputs, computeNodeTopsNew(inputs));
  });

  it('neighbourhood of D — dual-parent convergence', () => {
    const inputs = new Map<string, NodeInput>([
      ['Bomgineering', { parents: [],               children: ['C'],            height: 146 }],
      ['A',            { parents: [],               children: ['I'],            height: 74  }],
      ['C',            { parents: ['Bomgineering'],  children: ['D','E','G'],    height: 122 }],
      ['I',            { parents: ['A'],             children: ['D','DevOps'],   height: 74  }],
      ['D',            { parents: ['C','I'],         children: [],               height: 74  }],
      ['E',            { parents: ['C'],             children: [],               height: 74  }],
      ['G',            { parents: ['C'],             children: [],               height: 74  }],
      ['DevOps',       { parents: ['I'],             children: [],               height: 146 }],
    ]);
    perturbationCheck(inputs, computeNodeTopsNew(inputs));
  });
});
