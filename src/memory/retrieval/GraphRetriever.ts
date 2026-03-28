import { RelationType } from "../../types.js";
import { RelationGraph } from "../RelationGraph.js";
import type { IRelationStore } from "../relation/IRelationStore.js";
import type { IBlockStore } from "../store/IBlockStore.js";
import type { IBlockRetriever } from "./IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput } from "./types.js";

export class GraphRetriever implements IBlockRetriever {
  constructor(
    private readonly graph: RelationGraph,
    private readonly relationStore: IRelationStore,
    private readonly blockStore: IBlockStore
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    if (!input.seedBlockIds || input.seedBlockIds.length === 0) return [];
    const seedSet = new Set(input.seedBlockIds);
    const direction = input.direction ?? "both";
    const relationTypes = input.relationTypes ?? [RelationType.CONTEXT, RelationType.FOLLOWS];
    const depth = input.depth ?? 1;
    const traversalNodes = this.collectTraversalNodes({
      seedIds: input.seedBlockIds,
      direction,
      relationTypes,
      depth
    });
    const confidenceMap = await this.buildConfidenceMapForNodes({
      nodeIds: traversalNodes,
      direction,
      relationTypes
    });
    const scoreMap = this.weightedTraverse({
      seedIds: input.seedBlockIds,
      direction,
      relationTypes,
      depth,
      confidenceMap
    });

    for (const seedId of seedSet) {
      scoreMap.delete(seedId);
    }

    const maxScore = Math.max(...scoreMap.values(), 0);
    const normalizer = maxScore > 0 ? maxScore : 1;
    const hits: RetrievalHit[] = [];
    for (const [blockId, rawScore] of scoreMap.entries()) {
      if (!isBlockNodeId(blockId)) continue;
      const block = await this.blockStore.get(blockId);
      if (!block) continue;
      hits.push({
        blockId,
        score: rawScore / normalizer,
        source: "graph",
        block
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, input.topK);
  }

  private async buildConfidenceMapForNodes(input: {
    nodeIds: Set<string>;
    direction: RetrievalInput["direction"];
    relationTypes: RelationType[];
  }): Promise<Map<string, number>> {
    const { nodeIds, direction, relationTypes } = input;
    const allowType = (type: RelationType): boolean =>
      relationTypes.length === 0 || relationTypes.includes(type);

    const map = new Map<string, number>();
    const outgoingNeeded = direction === "outgoing" || direction === "both";
    const incomingNeeded = direction === "incoming" || direction === "both";

    const outgoingTasks: Array<Promise<void>> = [];
    const incomingTasks: Array<Promise<void>> = [];

    for (const nodeId of nodeIds) {
      if (outgoingNeeded) {
        outgoingTasks.push(
          Promise.resolve(this.relationStore.listOutgoing(nodeId)).then((relations) => {
            for (const relation of relations) {
              if (!allowType(relation.type)) continue;
              const key = edgeKey(relation.src, relation.dst, relation.type);
              const confidence = clampConfidence(relation.confidence ?? defaultConfidence(relation.type));
              const existing = map.get(key);
              if (existing === undefined || existing < confidence) {
                map.set(key, confidence);
              }
            }
          })
        );
      }

      if (incomingNeeded) {
        incomingTasks.push(
          Promise.resolve(this.relationStore.listIncoming(nodeId)).then((relations) => {
            for (const relation of relations) {
              if (!allowType(relation.type)) continue;
              const key = edgeKey(relation.src, relation.dst, relation.type);
              const confidence = clampConfidence(relation.confidence ?? defaultConfidence(relation.type));
              const existing = map.get(key);
              if (existing === undefined || existing < confidence) {
                map.set(key, confidence);
              }
            }
          })
        );
      }
    }

    await Promise.all(outgoingTasks);
    await Promise.all(incomingTasks);

    return map;
  }

  private collectTraversalNodes(input: {
    seedIds: string[];
    direction: RetrievalInput["direction"];
    relationTypes: RelationType[];
    depth: number;
  }): Set<string> {
    const allowType = (type: RelationType): boolean =>
      input.relationTypes.length === 0 || input.relationTypes.includes(type);
    const visited = new Set(input.seedIds);
    let active = new Set(input.seedIds);

    for (let step = 1; step <= input.depth; step += 1) {
      const next = new Set<string>();
      for (const nodeId of active) {
        if (input.direction === "outgoing" || input.direction === "both") {
          for (const edge of this.graph.getOutgoingTyped(nodeId)) {
            if (!allowType(edge.type)) continue;
            if (!visited.has(edge.blockId)) {
              visited.add(edge.blockId);
              next.add(edge.blockId);
            }
          }
        }
        if (input.direction === "incoming" || input.direction === "both") {
          for (const edge of this.graph.getIncomingTyped(nodeId)) {
            if (!allowType(edge.type)) continue;
            if (!visited.has(edge.blockId)) {
              visited.add(edge.blockId);
              next.add(edge.blockId);
            }
          }
        }
      }
      if (next.size === 0) break;
      active = next;
    }

    return visited;
  }

  private weightedTraverse(input: {
    seedIds: string[];
    direction: RetrievalInput["direction"];
    relationTypes: RelationType[];
    depth: number;
    confidenceMap: Map<string, number>;
  }): Map<string, number> {
    const allowType = (type: RelationType): boolean =>
      input.relationTypes.length === 0 || input.relationTypes.includes(type);
    const frontier = new Map<string, number>();
    const accumulated = new Map<string, number>();
    const decay = 0.88;

    for (const seedId of input.seedIds) {
      frontier.set(seedId, (frontier.get(seedId) ?? 0) + 1 / input.seedIds.length);
    }

    let active = frontier;
    for (let step = 1; step <= input.depth; step += 1) {
      const next = new Map<string, number>();
      for (const [nodeId, nodeScore] of active.entries()) {
        const edges: Array<{ target: string; type: RelationType; confidence: number }> = [];

        if (input.direction === "outgoing" || input.direction === "both") {
          for (const edge of this.graph.getOutgoingTyped(nodeId)) {
            if (!allowType(edge.type)) continue;
            edges.push({
              target: edge.blockId,
              type: edge.type,
              confidence: resolveConfidence(input.confidenceMap, nodeId, edge.blockId, edge.type)
            });
          }
        }

        if (input.direction === "incoming" || input.direction === "both") {
          for (const edge of this.graph.getIncomingTyped(nodeId)) {
            if (!allowType(edge.type)) continue;
            edges.push({
              target: edge.blockId,
              type: edge.type,
              confidence: resolveConfidence(input.confidenceMap, edge.blockId, nodeId, edge.type)
            });
          }
        }

        if (edges.length === 0) continue;
        const share = (nodeScore / edges.length) * Math.pow(decay, step - 1);
        for (const edge of edges) {
          const weighted = share * edge.confidence;
          next.set(edge.target, (next.get(edge.target) ?? 0) + weighted);
          accumulated.set(edge.target, (accumulated.get(edge.target) ?? 0) + weighted);
        }
      }
      active = next;
      if (active.size === 0) break;
    }

    return accumulated;
  }
}

function edgeKey(src: string, dst: string, type: RelationType): string {
  return `${src}|${dst}|${type}`;
}

function resolveConfidence(
  table: Map<string, number>,
  src: string,
  dst: string,
  type: RelationType
): number {
  return table.get(edgeKey(src, dst, type)) ?? defaultConfidence(type);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.05, Math.min(1, value));
}

function defaultConfidence(type: RelationType): number {
  if (type === RelationType.FOLLOWS) return 0.9;
  if (type === RelationType.CAUSES) return 0.75;
  if (type === RelationType.PARENT_TASK || type === RelationType.CHILD_TASK) return 0.7;
  if (type === RelationType.ALTERNATIVE) return 0.6;
  if (type === RelationType.SNAPSHOT_OF_FILE) return 0.58;
  if (type === RelationType.FILE_MENTIONS_BLOCK) return 0.57;
  return 0.55;
}

function isBlockNodeId(nodeId: string): boolean {
  return !nodeId.startsWith("file:") && !nodeId.startsWith("snapshot:");
}
