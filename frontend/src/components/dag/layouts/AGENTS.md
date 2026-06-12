# frontend/src/components/dag/layouts/ — layout backends

Each file implements the `LayoutFn` contract from `types.ts`:

```ts
type LayoutFn = (nodes: Map<string, NodeInput>) => NodePositions;
// NodePositions = Map<string, { x: number; y: number }> — top-left React Flow positions
```

The registry in `index.ts` maps `LayoutAlgorithm` string keys to
`{ label: string; fn: LayoutFn }`. The Panel selector in `DagFlow.tsx`
enumerates `Object.keys(LAYOUTS)`, so it stays current automatically.

## Adding a new backend

1. Create `<name>.ts` exporting a `const <name>Layout: LayoutFn`.
2. Add one entry to `LAYOUTS` in `index.ts`.
3. Re-export from `index.ts` if callers need direct access.

That is all — no other files need to change.

## Axis convention for d3-dag backends

d3-dag layouts are top-to-bottom by default. We want left-to-right, so
all three d3-dag backends rotate 90° by swapping axes in `nodeSize`:

```
nodeSize[0] = within-layer spread  → becomes React Flow y  (varies per node)
nodeSize[1] = between-layer depth  → becomes React Flow x  (= COLUMN_WIDTH)
```

After `layout(graph)`, read positions as:
```ts
x = node.y - COLUMN_WIDTH / 2   // between-layer axis → LR x
y = node.x - nodeHeight / 2     // within-layer axis  → LR y
```

## Constants

All shared constants (column widths, gaps, header heights) live in
`types.ts` and are re-exported from `index.ts`. Import from `./layouts`
or `./layouts/types`, not from individual backend files.
