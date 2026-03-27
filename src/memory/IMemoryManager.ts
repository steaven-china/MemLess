import type { BlockRef, Context, MemoryEvent, ProactiveTriggerSource } from "../types.js";

export interface IMemoryManager {
  addEvent(event: MemoryEvent): Promise<void>;
  getContext(query: string, triggerSource?: ProactiveTriggerSource): Promise<Context>;
  sealCurrentBlock(): Promise<void>;
  createNewBlock(): void;
  retrieveBlocks(query: string): Promise<BlockRef[]>;
  tickProactiveWakeup(): Promise<void>;
  getActiveBlockId?(): string | undefined;
}
