import { graphStratify, grid, type GraphNode } from "d3-dag";
import type { LayoutFn } from "./types";
import { COLUMN_WIDTH, NODE_GAP } from "./types";

type Datum = { id: string; parentIds: string[] };

export const gridLayout: LayoutFn = (nodes) => {
  const data: Datum[] = Array.from(nodes.entries()).map(([id, n]) => ({
    id,
    parentIds: n.parents.filter((p) => nodes.has(p)),
  }));

  const graph = graphStratify()(data);

  // Same 90° rotation as sugiyama: swap within-layer / between-layer axes.
  const layout = grid()
    .nodeSize((n: GraphNode<Datum, unknown>) => {
      const h = nodes.get(n.data.id)?.height ?? 60;
      return [h + NODE_GAP, COLUMN_WIDTH] as const;
    })
    .gap([0, 0]);

  layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes()) {
    const id = node.data.id;
    const h = nodes.get(id)?.height ?? 60;
    positions.set(id, {
      x: node.y - COLUMN_WIDTH / 2,
      y: node.x - h / 2,
    });
  }
  return positions;
};
