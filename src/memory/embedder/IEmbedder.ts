export interface EmbedOptions {
  /** 文本 token 数（用于 HybridEmbedder 判断策略） */
  tokenCount?: number;
  /** 块标签（用于 HybridEmbedder 判断是否强制 local） */
  tags?: string[];
  /** 显式指定模式（仅 HybridEmbedder 使用） */
  mode?: "hash-only" | "local-only" | "hybrid";
}

export interface IEmbedder {
  embed(text: string, options?: EmbedOptions): Promise<number[]>;
}

