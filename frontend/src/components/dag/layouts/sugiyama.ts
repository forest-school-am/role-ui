import { graphStratify, sugiyama, type GraphNode } from "d3-dag";
import type { LayoutFn } from "./types";
import { COLUMN_WIDTH, NODE_GAP } from "./types";

type Datum = { id: string; parentIds: string[] };

export const sugiyamaLayout: LayoutFn = (nodes) => {
  const data: Datum[] = Array.from(nodes.entries()).map(([id, n]) => ({
    id,
    parentIds: n.parents.filter((p) => nodes.has(p)),
  }));

  const graph = graphStratify()(data);

  // d3-dag is top-to-bottom by default; we want left-to-right.
  // Rotate 90° by swapping axes in nodeSize and the final position read-out:
  //   nodeSize[0] = within-layer spread → becomes React Flow y (variable per node)
  //   nodeSize[1] = between-layer depth → becomes React Flow x (= COLUMN_WIDTH)
  const layout = sugiyama()
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
      x: node.y - COLUMN_WIDTH / 2, // between-layer axis → React Flow x
      y: node.x - h / 2,            // within-layer axis  → React Flow y
    });
  }
  return positions;
};
