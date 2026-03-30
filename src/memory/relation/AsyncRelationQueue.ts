import type { RelationGraph } from "../RelationGraph.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IRelationExtractor } from "./RelationExtractor.js";
import type { ExtractedRelation } from "./RelationExtractor.js";
import type { IRelationStore } from "./IRelationStore.js";

export interface AsyncRelationQueueOptions {
  maxNeighbors: number;
  relationStore?: IRelationStore;
  relationTimestampResolver?: (block: MemoryBlock, relation: ExtractedRelation) => number;
  minConfidence?: number;
  allowedTypes?: ReadonlyArray<ExtractedRelation["type"]>;
  relationTypeAliases?: Partial<Record<string, ExtractedRelation["type"]>>;
  candidatePromoteScore?: number;
  candidateDecay?: number;
  conflictDetectionEnabled?: boolean;
  onError?: (error: unknown) => void;
}

export class AsyncRelationQueue {
  private readonly queue: MemoryBlock[] = [];
  private running = false;
  private processingPromise?: Promise<void>;
  private drainResolvers: Array<() => void> = [];

  constructor(
    private readonly extractor: IRelationExtractor,
    private readonly graph: RelationGraph,
    private readonly getNeighbors: (block: MemoryBlock, limit: number) => Promise<MemoryBlock[]>,
    private readonly options: AsyncRelationQueueOptions
  ) {}

  enqueue(block: MemoryBlock): void {
    this.queue.push(block);
    void this.process();
  }

  async drain(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private async process(): Promise<void> {
    if (this.processingPromise) return;

    this.processingPromise = (async () => {
      if (this.running) return;
      this.running = true;

      while (this.queue.length > 0) {
        const block = this.queue.shift();
        if (!block) continue;
        try {
          const neighbors = await this.getNeighbors(block, this.options.maxNeighbors);
          const relations = await this.extractor.extract(block, neighbors);
          const normalizedRelations = this.normalizeRelations(relations);
          for (const relation of normalizedRelations) {
            this.graph.addRelation(relation.src, relation.dst, relation.type);
            const timestamp =
              this.options.relationTimestampResolver?.(block, relation) ?? Date.now();
            await this.options.relationStore?.add({
              src: relation.src,
              dst: relation.dst,
              type: relation.type,
              confidence: relation.confidence,
              timestamp
            });
          }
        } catch (error) {
          this.options.onError?.(error);
        }
      }

      this.running = false;
      this.resolveDrainIfIdle();
    })()
      .finally(() => {
        this.processingPromise = undefined;
        if (this.queue.length > 0) {
          void this.process();
        } else {
          this.resolveDrainIfIdle();
        }
      });

    await this.processingPromise;
  }

  private resolveDrainIfIdle(): void {
    if (this.running || this.queue.length > 0) return;
    if (this.drainResolvers.length === 0) return;
    const resolvers = [...this.drainResolvers];
    this.drainResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private normalizeRelations(relations: ExtractedRelation[]): ExtractedRelation[] {
    const minConfidence = Math.max(0, Math.min(1, this.options.minConfidence ?? 0));
    const allowedTypes = this.options.allowedTypes
      ? new Set(this.options.allowedTypes)
      : undefined;
    const aliases = this.options.relationTypeAliases ?? {};
    const table = new Map<string, ExtractedRelation>();

    for (const relation of relations) {
      const normalizedType = this.normalizeType(String(relation.type), aliases);
      if (!normalizedType) continue;
      if (allowedTypes && !allowedTypes.has(normalizedType)) continue;

      const confidence = Math.max(0, Math.min(1, relation.confidence));
      if (confidence < minConfidence) continue;

      const normalized: ExtractedRelation = {
        ...relation,
        type: normalizedType,
        confidence
      };
      const key = `${normalized.src}|${normalized.dst}|${normalized.type}`;
      const existing = table.get(key);
      if (!existing || normalized.confidence > existing.confidence) {
        table.set(key, normalized);
      }
    }

    return [...table.values()];
  }

  private normalizeType(
    type: string,
    aliases: Partial<Record<string, ExtractedRelation["type"]>>
  ): ExtractedRelation["type"] | undefined {
    const canonical = aliases[type] ?? aliases[type.toUpperCase()] ?? (type as ExtractedRelation["type"]);
    return canonical;
  }
}
