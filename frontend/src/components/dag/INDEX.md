# frontend/src/components/dag/ index

| Item | Description |
|---|---|
| `DAGCanvas.tsx` | Public entry point; holds `measuredHeights` and `algorithm` state |
| `MeasureNodes.tsx` | Off-screen rendering pass to measure real node heights |
| `DagFlow.tsx` | ReactFlow canvas, Panel layout selector, graph element builder |
| `layouts/` | Layout backend registry and individual algorithm files |
| `dagLayout.test.ts` | Structural + perturbation tests for layout backends |
