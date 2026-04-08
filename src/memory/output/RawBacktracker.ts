import type { BlockId, BlockRef } from "../../types.js";
import type { IRawEventStore } from "../raw/IRawEventStore.js";

export class RawBacktracker {
  constructor(private readonly rawStore: IRawEventStore) {}

  async fillRawEvents(blocks: BlockRef[]): Promise<BlockRef[]> {
    const needsHydration: BlockId[] = [];
    for (const block of blocks) {
      if (!block.rawEvents || block.rawEvents.length === 0) {
        needsHydration.push(block.id);
      }
    }

    if (needsHydration.length === 0) return blocks;

    let hydrated: Map<BlockId, import("../../types.js").MemoryEvent[]>;
    if (this.rawStore.getMany) {
      hydrated = await this.rawStore.getMany(needsHydration);
    } else {
      hydrated = new Map();
      await Promise.all(
        needsHydration.map(async (id) => {
          const events = await this.rawStore.get(id);
          if (events) hydrated.set(id, events);
        })
      );
    }

    return blocks.map((block) => {
      if (block.rawEvents && block.rawEvents.length > 0) return block;
      return { ...block, rawEvents: hydrated.get(block.id) ?? [] };
    });
  }
}
