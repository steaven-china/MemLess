import type { BlockTag } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";

export interface ITagger {
  tag(block: MemoryBlock): Promise<BlockTag[]>;
}
