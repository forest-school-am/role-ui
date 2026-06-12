// ---------------------------------------------------------------------------
// Layout types shared by all backends
// ---------------------------------------------------------------------------

export type NodeInput = {
  parents: string[];
  children: string[];
  height: number;
};

/** Top-left React Flow position for each node id. */
export type NodePositions = Map<string, { x: number; y: number }>;

/** Contract every layout backend must satisfy. */
export type LayoutFn = (nodes: Map<string, NodeInput>) => NodePositions;

// ---------------------------------------------------------------------------
// Shared constants (used by both layout backends and the canvas renderer)
// ---------------------------------------------------------------------------

export const COLUMN_WIDTH = 320;
export const NODE_GAP = 20;

// Tailwind JIT requires static class strings, so NODE_CONTENT_WIDTH cannot be
// referenced from the max-w-[260px] class in GroupNodeContent.tsx. Keep both in sync manually.
export const NODE_CONTENT_WIDTH = 260;
export const NODE_HEADER_HEIGHT = 42;
export const NODE_MEMBER_ROW_HEIGHT = 24;
export const NODE_FOOTER_PAD = 8;

export const VIRTUAL_NODE_WIDTH = 220;
export const VIRTUAL_GAP = 60;
export const VIRTUAL_Y_OFFSET = 120;
