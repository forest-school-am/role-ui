import { springLayout } from "./spring";
import { sugiyamaLayout } from "./sugiyama";
import { zherebkoLayout } from "./zherebko";
import { gridLayout } from "./grid";
import type { LayoutFn } from "./types";

export type LayoutAlgorithm = "spring" | "sugiyama" | "zherebko" | "grid";

export const LAYOUTS: Record<LayoutAlgorithm, { label: string; fn: LayoutFn }> = {
  spring:   { label: "Spring",    fn: springLayout   },
  sugiyama: { label: "Sugiyama",  fn: sugiyamaLayout },
  zherebko: { label: "Zherebko", fn: zherebkoLayout  },
  grid:     { label: "Grid",      fn: gridLayout      },
};

export { springLayout, sugiyamaLayout, zherebkoLayout, gridLayout };
export type { LayoutFn, NodeInput, NodePositions } from "./types";
export {
  COLUMN_WIDTH,
  NODE_GAP,
  NODE_HEADER_HEIGHT,
  NODE_MEMBER_ROW_HEIGHT,
  NODE_FOOTER_PAD,
  VIRTUAL_NODE_WIDTH,
  VIRTUAL_GAP,
  VIRTUAL_Y_OFFSET,
} from "./types";
export { computeNodeTops, computeNodeTopsNew } from "./spring";
