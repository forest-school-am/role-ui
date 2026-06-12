# frontend/src/components/dag/layouts/ index

| Item | Description |
|---|---|
| `types.ts` | `NodeInput`, `NodePositions`, `LayoutFn` types; all shared constants |
| `index.ts` | `LayoutAlgorithm` type, `LAYOUTS` registry; re-exports everything |
| `spring.ts` | Custom spring-energy algorithm; also exports `computeNodeTopsNew` for tests |
| `sugiyama.ts` | d3-dag Sugiyama layered layout |
| `zherebko.ts` | d3-dag Zherebko topological layout |
| `grid.ts` | d3-dag Grid layout |
