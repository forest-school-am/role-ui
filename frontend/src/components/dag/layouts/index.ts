import { sugiyamaLayout } from "./sugiyama";
import { gridLayout } from "./grid";
import type { LayoutFn } from "./types";

export type LayoutAlgorithm = "sugiyama" | "grid";

export const LAYOUTS: Record<LayoutAlgorithm, { label: string; fn: LayoutFn }> = {
  sugiyama: { label: "Sugiyama", fn: sugiyamaLayout },
  grid:     { label: "Grid",     fn: gridLayout      },
};

export { sugiyamaLayout, gridLayout };
export type { LayoutFn, NodeInput, NodePositions } from "./types";
export {
  COLUMN_WIDTH,
  NODE_GAP,
  NODE_CONTENT_WIDTH,
  NODE_HEADER_HEIGHT,
  NODE_MEMBER_ROW_HEIGHT,
  NODE_FOOTER_PAD,
  VIRTUAL_NODE_WIDTH,
  VIRTUAL_GAP,
  VIRTUAL_Y_OFFSET,
} from "./types";
