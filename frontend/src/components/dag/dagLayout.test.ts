import { describe, it, expect } from 'vitest';
import { computeLayout, COLUMN_WIDTH } from './dagLayout';
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
// Test cases
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
