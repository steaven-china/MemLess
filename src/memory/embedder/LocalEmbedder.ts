import type { IEmbedder, EmbedOptions } from "./IEmbedder.js";

/**
 * Batch-capable pipeline interface.
 * Single string → { data: ArrayLike<number> }
 * String array  → { dims: number[]; data: ArrayLike<number> }  (shape [N, hidden])
 */
interface EmbeddingPipeline {
  (
    text: string,
    options: { pooling: string; normalize: boolean }
  ): Promise<{ data: ArrayLike<number> }>;
  (
    text: string[],
    options: { pooling: string; normalize: boolean }
  ): Promise<{ dims: number[]; data: ArrayLike<number> }>;
}

export interface LocalEmbedderConfig {
  /** HuggingFace model id — must support feature-extraction.
   *  Default: "Xenova/multilingual-e5-small" (384-dim, Chinese+English). */
  model?: string;
  /** Use quantized (int8) ONNX weights.  Smaller download, faster inference.
   *  Default: true. */
  quantized?: boolean;
  /**
   * Base URL for model downloads.  Override to use a mirror (e.g.
   * "https://hf-mirror.com/" for users in mainland China).
   * Default: HuggingFace Hub ("https://huggingface.co/").
   */
  mirror?: string;
}

/**
 * Semantic text embedder backed by @xenova/transformers.
 *
 * **Lazy**: the ONNX model is downloaded and loaded on the *first* call to
 * `embed()`, not at construction time.  Subsequent calls reuse the same
 * pipeline instance.
 *
 * **Static pipeline cache**: all LocalEmbedder instances sharing the same
 * model name reuse one ONNX session — critical when many runtimes are created
 * in the same process (e.g. eval bench with hundreds of cases).
 *
 * **Batch support**: `embedBatch()` sends N texts in a single ONNX forward
 * pass, which is 3-8× faster than N sequential `embed()` calls.
 */
export class LocalEmbedder implements IEmbedder {
  // Static cache keyed by "modelName:quantized" so all instances share one session.
  private static readonly pipelineCache = new Map<
    string,
    Promise<EmbeddingPipeline>
  >();

  private readonly modelName: string;
  private readonly quantized: boolean;
  private readonly mirror: string | undefined;
  private readonly cacheKey: string;

  constructor(config: LocalEmbedderConfig = {}) {
    this.modelName = config.model ?? "Xenova/multilingual-e5-small";
    this.quantized = config.quantized ?? true;
    this.mirror = config.mirror;
    this.cacheKey = `${this.modelName}:${this.quantized}`;
  }

  // ------------------------------------------------------------------ //
  //  Public API                                                          //
  // ------------------------------------------------------------------ //

  async embed(text: string, _options?: EmbedOptions): Promise<number[]> {
    const pipe = await this.getPipeline();
    const result = await (pipe as (t: string, o: object) => Promise<{ data: ArrayLike<number> }>)(
      text,
      { pooling: "mean", normalize: true }
    );
    return Array.from(result.data);
  }

  /**
   * Embed multiple texts in a single ONNX forward pass.
   * 3-8× faster than calling embed() N times sequentially.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.embed(texts[0]!)];

    const pipe = await this.getPipeline();
    const result = await (pipe as (t: string[], o: object) => Promise<{ dims: number[]; data: ArrayLike<number> }>)(
      texts,
      { pooling: "mean", normalize: true }
    );

    // result.dims = [batchSize, hiddenDim]
    const hiddenDim = result.dims[1]!;
    const flat = Array.from(result.data);
    return texts.map((_, i) => flat.slice(i * hiddenDim, (i + 1) * hiddenDim));
  }

  // ------------------------------------------------------------------ //
  //  Static pipeline management                                          //
  // ------------------------------------------------------------------ //

  private getPipeline(): Promise<EmbeddingPipeline> {
    const cached = LocalEmbedder.pipelineCache.get(this.cacheKey);
    if (cached) return cached;

    const promise = this.loadPipeline().catch((err: unknown) => {
      // Remove from cache on failure so the next call retries.
      LocalEmbedder.pipelineCache.delete(this.cacheKey);
      throw err;
    });
    LocalEmbedder.pipelineCache.set(this.cacheKey, promise);
    return promise;
  }

  private async loadPipeline(): Promise<EmbeddingPipeline> {
    const { pipeline, env } = await import("@xenova/transformers");

    if (this.mirror) {
      (env as { remoteHost?: string }).remoteHost = this.mirror;
    }

    const pipe = await pipeline("feature-extraction", this.modelName, {
      quantized: this.quantized
    });
    return pipe as unknown as EmbeddingPipeline;
  }
}
