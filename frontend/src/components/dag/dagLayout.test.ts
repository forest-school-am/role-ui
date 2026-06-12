import { describe, it, expect } from 'vitest';
import { computeLayout, computeNodeTops, COLUMN_WIDTH, NODE_GAP } from './dagLayout';
import type { NodeInput } from './dagLayout';
import { makeGroupDetail } from '../../test/factories';
import type { GroupNodeType } from '../group/GroupNode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => undefined;
const emptyOverrides = new Map<string, number>();

function getNode(nodes: GroupNodeType[], name: string): GroupNodeType {
  const node = nodes.find((n) => n.id === name);
  if (!node) throw new Error(`Node "${name}" not found`);
  return node;
}

function colOf(nodes: GroupNodeType[], name: string): number {
  return getNode(nodes, name).position.x / COLUMN_WIDTH;
}

/**
 * Returns true if no two nodes in the given column have overlapping y positions.
 * Uses strictly increasing y as the check (positions must be in order without overlap).
 */
function noOverlap(nodes: GroupNodeType[], col: number): boolean {
  const inCol = nodes.filter((n) => n.position.x === col * COLUMN_WIDTH);
  const sorted = [...inCol].sort((a, b) => a.position.y - b.position.y);
  return sorted.every((n, i) => i === 0 || n.position.y > sorted[i - 1].position.y);
}

function hasEdge(edges: { source: string; target: string }[], src: string, tgt: string): boolean {
  return edges.some((e) => e.source === src && e.target === tgt);
}

// ---------------------------------------------------------------------------
// Helper: computeColumnsFromInputs
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
  // Assign each node a level 0..3
  const levels: number[] = Array.from({ length: n }, (_, i) =>
    i === 0 ? 0 : Math.floor(rng() * 4),
  );
  // Sort by level so earlier indices have smaller levels
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => levels[a] - levels[b]);

  const ids = order.map((i) => `n${i}`);
  const nodeLevel = new Map(ids.map((id, idx) => [id, levels[order[idx]]]));

  const inputs = new Map<string, NodeInput>();
  for (const id of ids) {
    inputs.set(id, {
      parents: [],
      children: [],
      height: Math.floor(rng() * 150) + 50, // 50..200
    });
  }

  // Assign edges: for each node at level > 0, randomly pick 1..2 parents from lower levels
  for (const id of ids) {
    const lv = nodeLevel.get(id)!;
    if (lv === 0) continue;
    const candidates = ids.filter((other) => (nodeLevel.get(other) ?? 0) < lv);
    if (candidates.length === 0) continue;
    const numParents = Math.min(candidates.length, 1 + Math.floor(rng() * 2));
    // Shuffle candidates and pick first numParents
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

  // Derive columns
  const columnOf = computeColumnsFromInputs(inputs);

  // Group nodes by column, sorted by top
  const byColumn = new Map<number, string[]>();
  for (const [id, col] of columnOf) {
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(id);
  }
  for (const arr of byColumn.values()) {
    arr.sort((a, b) => (tops.get(a) ?? 0) - (tops.get(b) ?? 0));
  }

  // Mutable working copy of tops
  const t = new Map(tops);

  function center(id: string): number {
    return (t.get(id) ?? 0) + inputs.get(id)!.height / 2;
  }

  // Compute all edges as (parent, child) pairs
  const edges: [string, string][] = [];
  for (const [id, n] of inputs) {
    for (const child of n.children) {
      edges.push([id, child]);
    }
  }

  function sumDeltaY(): number {
    let s = 0;
    for (const [p, c] of edges) s += Math.abs(center(p) - center(c));
    return s;
  }

  const originalSum = sumDeltaY();

  // Ring buffer
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

  // Incremental sum update for edges touching `id`
  function costDeltaForMove(id: string, oldTop: number, newTop: number): number {
    const h = inputs.get(id)!.height;
    const oldC = oldTop + h / 2;
    const newC = newTop + h / 2;
    let delta = 0;
    for (const pid of inputs.get(id)!.parents) {
      const nc = center(pid);
      delta += Math.abs(newC - nc) - Math.abs(oldC - nc);
    }
    for (const cid of inputs.get(id)!.children) {
      const nc = center(cid);
      delta += Math.abs(newC - nc) - Math.abs(oldC - nc);
    }
    return delta;
  }

  const rng = makePrng(42);
  let currentSum = originalSum;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Collect all gaps across all columns
    interface Gap {
      col: number;
      aboveId: string; // node just above gap (move it down to close)
      belowId: string; // node just below gap (move it up to close)
      gapSize: number; // available space beyond NODE_GAP
      aboveBottom: number; // current bottom of aboveId
    }
    const gaps: Gap[] = [];

    for (const [col, ids] of byColumn) {
      // Re-sort by current t values
      ids.sort((a, b) => (t.get(a) ?? 0) - (t.get(b) ?? 0));
      for (let i = 0; i < ids.length - 1; i++) {
        const a = ids[i];
        const b = ids[i + 1];
        const aBottom = (t.get(a) ?? 0) + inputs.get(a)!.height;
        const bTop = t.get(b) ?? 0;
        const gapSize = bTop - aBottom - NODE_GAP;
        if (gapSize > 1) {
          gaps.push({ col, aboveId: a, belowId: b, gapSize, aboveBottom: aBottom });
        }
      }
    }

    if (gaps.length === 0) break;

    // Pick a random gap
    const gap = gaps[Math.floor(rng() * gaps.length)];

    // Pick above or below node (prefer unmarked)
    const candidates: string[] = [];
    if (!marked.has(gap.aboveId)) candidates.push(gap.aboveId);
    if (!marked.has(gap.belowId)) candidates.push(gap.belowId);
    if (candidates.length === 0) continue;

    const id = candidates[Math.floor(rng() * candidates.length)];
    const isAbove = id === gap.aboveId;

    // Determine how much we can move
    const maxMove = gap.gapSize;
    if (maxMove < 1) continue;
    const moveAmount = rng() * maxMove; // random in (0, gapSize)
    if (moveAmount < 0.5) continue;

    const oldTop = t.get(id)!;
    const newTop = isAbove ? oldTop + moveAmount : oldTop - moveAmount;

    // Apply move
    const delta = costDeltaForMove(id, oldTop, newTop);
    t.set(id, newTop);
    currentSum += delta;

    markNode(id);

    // Check against original
    if (currentSum < originalSum - 0.5) {
      throw new Error(
        `Perturbation test failed: layout improved from ${originalSum.toFixed(2)} to ${currentSum.toFixed(2)} ` +
        `by moving "${id}" ${isAbove ? 'down' : 'up'} by ${moveAmount.toFixed(1)}px in iteration ${iter}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Test cases — existing structural tests
// ---------------------------------------------------------------------------

describe('computeLayout', () => {
  it('single node — produces 1 node at x=0', () => {
    const groups = [makeGroupDetail({ name: 'A', parents: [], children: [] })];
    const { nodes, edges } = computeLayout(groups, noop, noop, emptyOverrides);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('A');
    expect(nodes[0].position.x).toBe(0);
    expect(edges).toHaveLength(0);
  });

  it('linear chain A→B→C — correct column assignments and 2 edges', () => {
    const groups = [
      makeGroupDetail({ name: 'A', parents: [], children: [{ name: 'B' }] }),
      makeGroupDetail({ name: 'B', parents: [{ name: 'A' }], children: [{ name: 'C' }] }),
      makeGroupDetail({ name: 'C', parents: [{ name: 'B' }], children: [] }),
    ];
    const { nodes, edges } = computeLayout(groups, noop, noop, emptyOverrides);

    expect(nodes).toHaveLength(3);
    expect(colOf(nodes, 'A')).toBe(0);
    expect(colOf(nodes, 'B')).toBe(1);
    expect(colOf(nodes, 'C')).toBe(2);

    expect(edges).toHaveLength(2);
    expect(hasEdge(edges, 'A', 'B')).toBe(true);
    expect(hasEdge(edges, 'B', 'C')).toBe(true);
  });

  it('balanced binary tree depth 2 — root at col 0, children at col 1, 2 edges', () => {
    const groups = [
      makeGroupDetail({ name: 'R', parents: [], children: [{ name: 'L' }, { name: 'Rr' }] }),
      makeGroupDetail({ name: 'L', parents: [{ name: 'R' }], children: [] }),
      makeGroupDetail({ name: 'Rr', parents: [{ name: 'R' }], children: [] }),
    ];
    const { nodes, edges } = computeLayout(groups, noop, noop, emptyOverrides);

    expect(nodes).toHaveLength(3);
    expect(colOf(nodes, 'R')).toBe(0);
    expect(colOf(nodes, 'L')).toBe(1);
    expect(colOf(nodes, 'Rr')).toBe(1);

    expect(noOverlap(nodes, 1)).toBe(true);

    expect(edges).toHaveLength(2);
    expect(hasEdge(edges, 'R', 'L')).toBe(true);
    expect(hasEdge(edges, 'R', 'Rr')).toBe(true);
  });

  it('balanced binary tree depth 3 — correct columns, no overlap, 6 edges', () => {
    // root → 2 children → 4 grandchildren
    const groups = [
      makeGroupDetail({ name: 'Root', parents: [], children: [{ name: 'C1' }, { name: 'C2' }] }),
      makeGroupDetail({ name: 'C1', parents: [{ name: 'Root' }], children: [{ name: 'G1' }, { name: 'G2' }] }),
      makeGroupDetail({ name: 'C2', parents: [{ name: 'Root' }], children: [{ name: 'G3' }, { name: 'G4' }] }),
      makeGroupDetail({ name: 'G1', parents: [{ name: 'C1' }], children: [] }),
      makeGroupDetail({ name: 'G2', parents: [{ name: 'C1' }], children: [] }),
      makeGroupDetail({ name: 'G3', parents: [{ name: 'C2' }], children: [] }),
      makeGroupDetail({ name: 'G4', parents: [{ name: 'C2' }], children: [] }),
    ];
    const { nodes, edges } = computeLayout(groups, noop, noop, emptyOverrides);

    expect(nodes).toHaveLength(7);

    // Column assignments
    expect(colOf(nodes, 'Root')).toBe(0);
    expect(colOf(nodes, 'C1')).toBe(1);
    expect(colOf(nodes, 'C2')).toBe(1);
    expect(colOf(nodes, 'G1')).toBe(2);
    expect(colOf(nodes, 'G2')).toBe(2);
    expect(colOf(nodes, 'G3')).toBe(2);
    expect(colOf(nodes, 'G4')).toBe(2);

    // No vertical overlap in any column
    expect(noOverlap(nodes, 0)).toBe(true);
    expect(noOverlap(nodes, 1)).toBe(true);
    expect(noOverlap(nodes, 2)).toBe(true);

    // 6 edges: Root→C1, Root→C2, C1→G1, C1→G2, C2→G3, C2→G4
    expect(edges).toHaveLength(6);
    expect(hasEdge(edges, 'Root', 'C1')).toBe(true);
    expect(hasEdge(edges, 'Root', 'C2')).toBe(true);
    expect(hasEdge(edges, 'C1', 'G1')).toBe(true);
    expect(hasEdge(edges, 'C1', 'G2')).toBe(true);
    expect(hasEdge(edges, 'C2', 'G3')).toBe(true);
    expect(hasEdge(edges, 'C2', 'G4')).toBe(true);
  });

  it('inverted binary tree — 4 leaves at col 0, 2 mid at col 1, apex at col 2, 6 edges', () => {
    // D, E → B; F, G → C; B, C → A
    const groups = [
      makeGroupDetail({ name: 'D', parents: [], children: [{ name: 'B' }] }),
      makeGroupDetail({ name: 'E', parents: [], children: [{ name: 'B' }] }),
      makeGroupDetail({ name: 'F', parents: [], children: [{ name: 'C' }] }),
      makeGroupDetail({ name: 'G', parents: [], children: [{ name: 'C' }] }),
      makeGroupDetail({ name: 'B', parents: [{ name: 'D' }, { name: 'E' }], children: [{ name: 'A' }] }),
      makeGroupDetail({ name: 'C', parents: [{ name: 'F' }, { name: 'G' }], children: [{ name: 'A' }] }),
      makeGroupDetail({ name: 'A', parents: [{ name: 'B' }, { name: 'C' }], children: [] }),
    ];
    const { nodes, edges } = computeLayout(groups, noop, noop, emptyOverrides);

    expect(nodes).toHaveLength(7);

    // Column assignments
    expect(colOf(nodes, 'D')).toBe(0);
    expect(colOf(nodes, 'E')).toBe(0);
    expect(colOf(nodes, 'F')).toBe(0);
    expect(colOf(nodes, 'G')).toBe(0);
    expect(colOf(nodes, 'B')).toBe(1);
    expect(colOf(nodes, 'C')).toBe(1);
    expect(colOf(nodes, 'A')).toBe(2);

    // No vertical overlap
    expect(noOverlap(nodes, 0)).toBe(true);
    expect(noOverlap(nodes, 1)).toBe(true);
    expect(noOverlap(nodes, 2)).toBe(true);

    // 6 edges
    expect(edges).toHaveLength(6);
    expect(hasEdge(edges, 'D', 'B')).toBe(true);
    expect(hasEdge(edges, 'E', 'B')).toBe(true);
    expect(hasEdge(edges, 'F', 'C')).toBe(true);
    expect(hasEdge(edges, 'G', 'C')).toBe(true);
    expect(hasEdge(edges, 'B', 'A')).toBe(true);
    expect(hasEdge(edges, 'C', 'A')).toBe(true);
  });

  it('diamond with extensions — A0/B0 at col 0, M at col 1, C2/D2 at col 2, 4 edges', () => {
    // A0, B0 (no parents) → M → C2, D2
    const groups = [
      makeGroupDetail({ name: 'A0', parents: [], children: [{ name: 'M' }] }),
      makeGroupDetail({ name: 'B0', parents: [], children: [{ name: 'M' }] }),
      makeGroupDetail({ name: 'M', parents: [{ name: 'A0' }, { name: 'B0' }], children: [{ name: 'C2' }, { name: 'D2' }] }),
      makeGroupDetail({ name: 'C2', parents: [{ name: 'M' }], children: [] }),
      makeGroupDetail({ name: 'D2', parents: [{ name: 'M' }], children: [] }),
    ];
    const { nodes, edges } = computeLayout(groups, noop, noop, emptyOverrides);

    expect(nodes).toHaveLength(5);

    // Column assignments
    expect(colOf(nodes, 'A0')).toBe(0);
    expect(colOf(nodes, 'B0')).toBe(0);
    expect(colOf(nodes, 'M')).toBe(1);
    expect(colOf(nodes, 'C2')).toBe(2);
    expect(colOf(nodes, 'D2')).toBe(2);

    // No vertical overlap
    expect(noOverlap(nodes, 0)).toBe(true);
    expect(noOverlap(nodes, 1)).toBe(true);
    expect(noOverlap(nodes, 2)).toBe(true);

    // 4 edges
    expect(edges).toHaveLength(4);
    expect(hasEdge(edges, 'A0', 'M')).toBe(true);
    expect(hasEdge(edges, 'B0', 'M')).toBe(true);
    expect(hasEdge(edges, 'M', 'C2')).toBe(true);
    expect(hasEdge(edges, 'M', 'D2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// New tests — local optimality (perturbation test)
// ---------------------------------------------------------------------------

describe('computeNodeTops — local optimality (perturbation test)', () => {
  it('chain of 5 nodes', () => {
    const inputs = new Map<string, NodeInput>([
      ['a', { parents: [], children: ['b'], height: 80 }],
      ['b', { parents: ['a'], children: ['c'], height: 60 }],
      ['c', { parents: ['b'], children: ['d'], height: 100 }],
      ['d', { parents: ['c'], children: ['e'], height: 70 }],
      ['e', { parents: ['d'], children: [], height: 90 }],
    ]);
    const tops = computeNodeTops(inputs);
    perturbationCheck(inputs, tops);
  });

  it('balanced binary tree depth 3', () => {
    const inputs = new Map<string, NodeInput>([
      ['root', { parents: [], children: ['c1', 'c2'], height: 60 }],
      ['c1', { parents: ['root'], children: ['g1', 'g2'], height: 80 }],
      ['c2', { parents: ['root'], children: ['g3', 'g4'], height: 80 }],
      ['g1', { parents: ['c1'], children: [], height: 120 }],
      ['g2', { parents: ['c1'], children: [], height: 50 }],
      ['g3', { parents: ['c2'], children: [], height: 90 }],
      ['g4', { parents: ['c2'], children: [], height: 70 }],
    ]);
    const tops = computeNodeTops(inputs);
    perturbationCheck(inputs, tops);
  });

  it('inverted binary tree', () => {
    const inputs = new Map<string, NodeInput>([
      ['d', { parents: [], children: ['b'], height: 60 }],
      ['e', { parents: [], children: ['b'], height: 90 }],
      ['f', { parents: [], children: ['c'], height: 75 }],
      ['g', { parents: [], children: ['c'], height: 55 }],
      ['b', { parents: ['d', 'e'], children: ['a'], height: 100 }],
      ['c', { parents: ['f', 'g'], children: ['a'], height: 80 }],
      ['a', { parents: ['b', 'c'], children: [], height: 65 }],
    ]);
    const tops = computeNodeTops(inputs);
    perturbationCheck(inputs, tops);
  });

  it('diamond + extensions', () => {
    const inputs = new Map<string, NodeInput>([
      ['a0', { parents: [], children: ['m'], height: 70 }],
      ['b0', { parents: [], children: ['m'], height: 110 }],
      ['m', { parents: ['a0', 'b0'], children: ['c2', 'd2'], height: 80 }],
      ['c2', { parents: ['m'], children: [], height: 60 }],
      ['d2', { parents: ['m'], children: [], height: 130 }],
    ]);
    const tops = computeNodeTops(inputs);
    perturbationCheck(inputs, tops);
  });

  // 5 random 10-node DAGs with different seeds
  for (const seed of [1, 7, 42, 137, 999]) {
    it(`random 10-node DAG seed=${seed}`, () => {
      const inputs = makeRandomDag(10, seed);
      const tops = computeNodeTops(inputs);
      perturbationCheck(inputs, tops);
    });
  }

  // ---------------------------------------------------------------------------
  // Live graph from authentik (as of 2026-06-12)
  // Heights = NODE_HEADER_HEIGHT(42) + memberCount*NODE_MEMBER_ROW_HEIGHT(24) + NODE_FOOTER_PAD(8)
  // ---------------------------------------------------------------------------

  it('live authentik graph — full 16-group structure', () => {
    const inputs = new Map<string, NodeInput>([
      // Col 0 — roots
      ['Bomgineering',       { parents: [],                         children: ['Platform', 'Growth', 'Marketing', 'C'], height: 146 }],
      ['A',                  { parents: [],                         children: ['H', 'I'],                               height: 74  }],
      ['B',                  { parents: [],                         children: [],                                       height: 74  }],
      ['authentik Admins',   { parents: [],                         children: [],                                       height: 122 }],
      ['authentik Read-only',{ parents: [],                         children: [],                                       height: 50  }],
      // Col 1
      ['Platform',           { parents: ['Bomgineering'],           children: ['F', 'G'],                               height: 146 }],
      ['Marketing',          { parents: ['Bomgineering'],           children: ['Growth'],                               height: 122 }],
      ['C',                  { parents: ['Bomgineering'],           children: ['D', 'E', 'G'],                          height: 122 }],
      ['H',                  { parents: ['A'],                      children: [],                                       height: 74  }],
      ['I',                  { parents: ['A'],                      children: ['D', 'DevOps'],                          height: 74  }],
      // Col 2
      ['F',                  { parents: ['Platform'],               children: [],                                       height: 74  }],
      ['G',                  { parents: ['Platform', 'C'],          children: [],                                       height: 74  }],
      ['Growth',             { parents: ['Bomgineering', 'Marketing'], children: [],                                    height: 122 }],
      ['D',                  { parents: ['C', 'I'],                 children: [],                                       height: 74  }],
      ['E',                  { parents: ['C'],                      children: [],                                       height: 74  }],
      ['DevOps',             { parents: ['I'],                      children: [],                                       height: 146 }],
    ]);
    const tops = computeNodeTops(inputs);
    perturbationCheck(inputs, tops);
  });

  // Neighbourhood of group D: two independent parent chains converge at D.
  //   Bomgineering (col 0) → C (col 1) → { D, E, G } (col 2)
  //   A           (col 0) → I (col 1) → { D, DevOps } (col 2)
  // D sits at col 2 with parents from both branches — the hardest placement case.
  it('neighbourhood of D — dual-parent convergence', () => {
    const inputs = new Map<string, NodeInput>([
      ['Bomgineering', { parents: [],              children: ['C'],            height: 146 }],
      ['A',            { parents: [],              children: ['I'],            height: 74  }],
      ['C',            { parents: ['Bomgineering'], children: ['D', 'E', 'G'], height: 122 }],
      ['I',            { parents: ['A'],            children: ['D', 'DevOps'], height: 74  }],
      ['D',            { parents: ['C', 'I'],       children: [],              height: 74  }],
      ['E',            { parents: ['C'],            children: [],              height: 74  }],
      ['G',            { parents: ['C'],            children: [],              height: 74  }],
      ['DevOps',       { parents: ['I'],            children: [],              height: 146 }],
    ]);
    const tops = computeNodeTops(inputs);
    perturbationCheck(inputs, tops);
  });
});
