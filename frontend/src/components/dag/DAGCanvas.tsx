import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GroupDetail, GroupNodeData } from '../../types';
import GroupNode, { type GroupNodeType } from './GroupNode';

interface DAGCanvasProps {
  groups: GroupDetail[];
  onGroupSelect: (pk: string) => void;
}

const nodeTypes: NodeTypes = {
  groupNode: GroupNode,
};

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 220;

function computeLayout(
  groups: GroupDetail[],
  onGroupSelect: (pk: string) => void,
): { nodes: GroupNodeType[]; edges: Edge[] } {
  // Deduplicate by pk — each group must appear exactly once
  const groupByPk = new Map<string, GroupDetail>();
  for (const g of groups) {
    groupByPk.set(g.pk, g);
  }
  const uniqueGroups = Array.from(groupByPk.values());
  const allPks = new Set(uniqueGroups.map((g) => g.pk));

  // Build children map: parent pk -> child pks
  const childrenOf = new Map<string, string[]>();
  for (const g of uniqueGroups) {
    for (const parentPk of g.parent_pks) {
      if (allPks.has(parentPk)) {
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
  for (const g of uniqueGroups) {
    const relevantParents = g.parent_pks.filter((p) => allPks.has(p));
    if (relevantParents.length === 0) {
      columnOf.set(g.pk, 0);
    }
  }

  // Iterative relaxation: repeat until no column value changes
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of uniqueGroups) {
      const relevantParents = g.parent_pks.filter((p) => allPks.has(p));
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

  // Any disconnected groups not yet assigned go to column 0
  for (const g of uniqueGroups) {
    if (!columnOf.has(g.pk)) columnOf.set(g.pk, 0);
  }

  // Group by column
  const byColumn = new Map<number, string[]>();
  for (const [pk, col] of columnOf.entries()) {
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(pk);
  }

  // Sort within each column by name for determinism
  for (const pks of byColumn.values()) {
    pks.sort((a, b) => {
      const na = groupByPk.get(a)?.name ?? '';
      const nb = groupByPk.get(b)?.name ?? '';
      return na.localeCompare(nb);
    });
  }

  const nodes: GroupNodeType[] = uniqueGroups.map((g) => {
    const col = columnOf.get(g.pk) ?? 0;
    const colList = byColumn.get(col) ?? [];
    const row = colList.indexOf(g.pk);

    const data: GroupNodeData = {
      groupPk: g.pk,
      groupName: g.name,
      detail: g,
      onSelect: onGroupSelect,
    };

    return {
      id: g.pk,
      type: 'groupNode' as const,
      position: { x: col * COLUMN_WIDTH, y: row * ROW_HEIGHT },
      data,
    };
  });

  const edges: Edge[] = [];
  for (const g of uniqueGroups) {
    for (const parentPk of g.parent_pks) {
      if (allPks.has(parentPk)) {
        edges.push({
          id: `${parentPk}->${g.pk}`,
          source: parentPk,
          target: g.pk,
          type: 'smoothstep',
        });
      }
    }
  }

  return { nodes, edges };
}

const DAGCanvas: React.FC<DAGCanvasProps> = ({ groups, onGroupSelect }) => {
  const { nodes, edges } = useMemo(
    () => computeLayout(groups, onGroupSelect),
    [groups, onGroupSelect],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-right"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

export default DAGCanvas;
