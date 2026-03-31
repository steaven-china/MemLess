import type { IEmbedder, EmbedOptions } from "./IEmbedder.js";
import { HashEmbedder } from "./HashEmbedder.js";
import { LocalEmbedder } from "./LocalEmbedder.js";

/**
 * HybridEmbedder: 分块级混合策略
 *
 * 设计目标：
 * - 重要块用 hybrid（双保险）
 * - 大块用 local（信息密度高，值得算准）
 * - 小块用 hash（快速过滤）
 *
 * 向量格式（固定 1024 维）：
 *   [256维 hash | 768维 local]
 *
 * 三种模式：
 * - hash-only:  [hash_vec | zeros(768)]  — 小块/碎片
 * - local-only: [zeros(256) | local_vec]  — 大块（>100 token）
 * - hybrid:     [hash_vec | local_vec]    — 重要块（important/conflict 标签）
 *
 * 策略配置：
 * - tokenThreshold: token 数阈值，超过则用 local（默认 100）
 * - forceHybridTags: 强制用 hybrid 的标签（默认 ["important", "conflict"]）
 * - mode: "auto" | "hash-only" | "local-only" | "hybrid"
 *
 * 检索策略：
 * - hash 初筛 top-50（快速覆盖）
 * - 如果候选里有 local 向量 → local 重排 top-K
 * - 否则 → 直接返回 hash 结果
 */

export interface HybridEmbedderConfig {
  /** Hash 向量维度（默认 256） */
  hashDim?: number;
  /** Hash 随机种子 */
  hashSeed?: number;
  /** Local 模型名称 */
  localModel?: string;
  /** Local 模型镜像地址 */
  localMirror?: string;
  /** Token 数阈值，超过此值用 local（默认 100） */
  tokenThreshold?: number;
  /** 强制使用 hybrid 的标签列表（默认 ["important", "conflict"]） */
  forceHybridTags?: string[];
  /** 默认模式（默认 "auto"） */
  defaultMode?: "auto" | "hash-only" | "local-only" | "hybrid";
}

export class HybridEmbedder implements IEmbedder {
  private readonly hashEmbedder: HashEmbedder;
  private readonly localEmbedder: LocalEmbedder;
  private readonly hashDim: number;
  private readonly localDim = 768; // bge-small-zh-v1.5 固定维度
  private readonly tokenThreshold: number;
  private readonly forceHybridTags: Set<string>;
  private readonly defaultMode: "auto" | "hash-only" | "local-only" | "hybrid";

  constructor(config: HybridEmbedderConfig = {}) {
    this.hashDim = config.hashDim ?? 256;
    this.tokenThreshold = config.tokenThreshold ?? 100;
    this.forceHybridTags = new Set(config.forceHybridTags ?? ["important", "conflict"]);
    this.defaultMode = config.defaultMode ?? "auto";

    this.hashEmbedder = new HashEmbedder(this.hashDim, config.hashSeed);
    this.localEmbedder = new LocalEmbedder({
      model: config.localModel,
      mirror: config.localMirror
    });
  }

  /**
   * 生成混合向量（固定 1024 维）
   *
   * 自动策略（mode="auto"）：
   * - tags 包含 forceHybridTags → hybrid（双保险）
   * - tokenCount > threshold → local-only（大块值得算准）
   * - 否则 → hash-only（小块快速过滤）
   */
  async embed(text: string, options?: EmbedOptions): Promise<number[]> {
    const mode = this.decideMode(options);

    switch (mode) {
      case "hash-only": {
        const hashVec = await this.hashEmbedder.embed(text);
        return [...hashVec, ...this.zeros(this.localDim)];
      }
      case "local-only": {
        const localVec = await this.localEmbedder.embed(text);
        return [...this.zeros(this.hashDim), ...localVec];
      }
      case "hybrid": {
        const [hashVec, localVec] = await Promise.all([
          this.hashEmbedder.embed(text),
          this.localEmbedder.embed(text)
        ]);
        return [...hashVec, ...localVec];
      }
    }
  }

  /**
   * 决定使用哪种模式
   */
  private decideMode(options?: EmbedOptions): "hash-only" | "local-only" | "hybrid" {
    // 显式指定模式
    if (options?.mode) return options.mode;

    // 非 auto 模式直接返回
    if (this.defaultMode !== "auto") return this.defaultMode as any;

    // auto 模式：根据 token 数和标签判断
    const tokenCount = options?.tokenCount ?? 0;
    const tags = options?.tags ?? [];
    const hasHybridTag = tags.some(t => this.forceHybridTags.has(t));

    // 重要块 → hybrid（双保险）
    if (hasHybridTag) {
      return "hybrid";
    }

    // 大块 → local-only（信息密度高，值得算准）
    if (tokenCount > this.tokenThreshold) {
      return "local-only";
    }

    // 小块 → hash-only（快速过滤）
    return "hash-only";
  }

  /**
   * 分离混合向量
   */
  splitVector(vec: number[]): { hash: number[]; local: number[] } {
    return {
      hash: vec.slice(0, this.hashDim),
      local: vec.slice(this.hashDim, this.hashDim + this.localDim)
    };
  }

  /**
   * 检测向量类型
   */
  detectVectorType(vec: number[]): "hash-only" | "local-only" | "hybrid" | "empty" {
    const { hash, local } = this.splitVector(vec);
    const hashNonZero = hash.some(v => v !== 0);
    const localNonZero = local.some(v => v !== 0);

    if (hashNonZero && localNonZero) return "hybrid";
    if (hashNonZero) return "hash-only";
    if (localNonZero) return "local-only";
    return "empty";
  }

  /**
   * 混合相似度计算
   *
   * 策略：
   * - 如果查询和候选都有 local 部分 → 用 local 相似度（准）
   * - 否则 → 用 hash 相似度（快）
   */
  similarity(vecA: number[], vecB: number[]): number {
    const { hash: hashA, local: localA } = this.splitVector(vecA);
    const { hash: hashB, local: localB } = this.splitVector(vecB);

    const localANonZero = localA.some(v => v !== 0);
    const localBNonZero = localB.some(v => v !== 0);

    // 优先用 local（如果双方都有）
    if (localANonZero && localBNonZero) {
      return this.cosineSimilarity(localA, localB);
    }

    // 否则用 hash
    return this.cosineSimilarity(hashA, hashB);
  }

  /**
   * 两阶段检索：hash 初筛 + local 重排（自适应）
   *
   * 策略：
   * 1. hash 初筛：prescreenK = min(max(totalBlocks * 0.05, 20), 100)
   *    - 小数据集（100块）→ 筛20
   *    - 中等数据集（1000块）→ 筛50
   *    - 大数据集（10000块）→ 筛100（上限）
   *
   * 2. local 重排：只对 min(prescreenK, topK * 3) 个候选重排
   *    - 避免对所有初筛结果都算 local（太慢）
   *    - topK=10 时，最多重排 30 个
   *
   * @param queryVec 查询向量
   * @param candidateVecs 候选向量列表
   * @param topK 最终返回数量
   */
  hybridSearch(
    queryVec: number[],
    candidateVecs: Array<{ id: string; vec: number[] }>,
    topK: number
  ): Array<{ id: string; score: number }> {
    if (candidateVecs.length === 0) return [];

    const totalBlocks = candidateVecs.length;
    // 自适应初筛数量：5% 的数据，最少20，最多100
    const prescreenK = Math.min(Math.max(Math.floor(totalBlocks * 0.05), 20), 100);
    // local 重排数量：最多 topK 的 3 倍
    const rerankK = Math.min(prescreenK, topK * 3);

    const { hash: queryHash, local: queryLocal } = this.splitVector(queryVec);
    const queryLocalNonZero = queryLocal.some(v => v !== 0);

    // 1. hash 初筛
    const hashScores = candidateVecs.map(({ id, vec }) => {
      const { hash } = this.splitVector(vec);
      const score = this.cosineSimilarity(queryHash, hash);
      return { id, score, vec };
    });

    hashScores.sort((a, b) => b.score - a.score);
    const prescreened = hashScores.slice(0, prescreenK);

    // 2. local 重排（如果查询有 local 部分，且候选中有 local 向量）
    if (queryLocalNonZero) {
      // 只对 top rerankK 个候选做 local 重排
      const toRerank = prescreened.slice(0, rerankK);
      const localScores = toRerank
        .map(({ id, vec }) => {
          const { local } = this.splitVector(vec);
          const localNonZero = local.some(v => v !== 0);
          // 如果候选没有 local 部分，保持 hash 分数
          const score = localNonZero
            ? this.cosineSimilarity(queryLocal, local)
            : this.cosineSimilarity(queryHash, this.splitVector(vec).hash);
          return { id, score };
        });

      localScores.sort((a, b) => b.score - a.score);
      return localScores.slice(0, Math.min(topK, localScores.length));
    }

    // 查询只有 hash，直接返回 hash 结果
    return prescreened
      .slice(0, Math.min(topK, prescreened.length))
      .map(({ id, score }) => ({ id, score }));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private zeros(n: number): number[] {
    return new Array(n).fill(0);
  }

  /**
   * 获取向量总维度
   */
  get dimension(): number {
    return this.hashDim + this.localDim;
  }
}
