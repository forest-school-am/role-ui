# frontend/src/components/dag/ — group DAG visualisation

React Flow canvas that renders the full group hierarchy as a directed
acyclic graph. Users can switch layout algorithms at runtime via a
Panel selector in the top-left corner of the canvas.

## Component hierarchy

```
DAGCanvas          ← exported; holds state (measuredHeights, algorithm)
  MeasureNodes     ← off-screen DOM measurement pass
  DagFlow          ← ReactFlow canvas + Panel selector + graph builder
    FocusController       ← fits viewport to a specific node on demand
    FitOnAlgorithmChange  ← re-centres canvas after layout switch
```

`DAGCanvas` is the only public export. Consumers pass `groups`,
callbacks, and an optional `focusNodeId`; everything else is internal.

## Layout backends (`layouts/`)

Each file exports a single `LayoutFn`:
`(nodes: Map<string, NodeInput>) => NodePositions`

The `LAYOUTS` registry in `layouts/index.ts` maps `LayoutAlgorithm`
keys to `{ label, fn }` objects. Adding a new algorithm = one new file
in `layouts/` + one entry in `LAYOUTS`. No other files need to change.

Current backends: `spring` (custom), `sugiyama`, `zherebko`, `grid`
(last three via d3-dag v1).

## Measurement pass

`MeasureNodes` renders every group node off-screen to get real DOM
heights before layout is computed. Heights are passed to `DagFlow` as
`heightOverrides`; the layout backends use these directly.

Always add explicit `width` and `height` to every `GroupNodeType` node
object — React Flow's MiniMap needs them before ResizeObserver fires.

## Key invariants

- `dagLayout.test.ts` tests layout backends directly via `NodeInput`.
  Do not test through `GroupDetail` or React components.
- The spring perturbation test for the live authentik graph (16 groups)
  is a known failing test — it requires a block-shift optimisation pass
  that has not yet been implemented.
