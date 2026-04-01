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
  /** auto-batch flush window in ms */
  batchWindowMs?: number;
  /** max texts per inference batch */
  maxBatchSize?: number;
  /** max pending embed requests before rejecting */
  queueMaxPending?: number;
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
  private readonly batchWindowMs: number;
  private readonly maxBatchSize: number;
  private readonly queueMaxPending: number;

  constructor(config: LocalEmbedderConfig = {}) {
    this.modelName = config.model ?? "Xenova/multilingual-e5-small";
    this.quantized = config.quantized ?? true;
    this.mirror = config.mirror;
    this.cacheKey = `${this.modelName}:${this.quantized}`;
    this.batchWindowMs = Math.max(1, config.batchWindowMs ?? 5);
    this.maxBatchSize = Math.max(1, config.maxBatchSize ?? 32);
    this.queueMaxPending = Math.max(this.maxBatchSize, config.queueMaxPending ?? 1024);
  }

  // ------------------------------------------------------------------ //
  //  Public API                                                          //
  // ------------------------------------------------------------------ //

  // Auto-batcher: accumulates embed() calls that arrive within `batchWindowMs`
  // and flushes them together as one ONNX forward pass.
  private batchQueue: Array<{
    text: string;
    resolve: (vec: number[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;

  async embed(text: string, _options?: EmbedOptions): Promise<number[]> {
    return new Promise<number[]>((resolve, reject) => {
      if (this.batchQueue.length >= this.queueMaxPending) {
        reject(new Error(`LocalEmbedder queue overflow: pending=${this.batchQueue.length}, max=${this.queueMaxPending}`));
        return;
      }
      this.batchQueue.push({ text, resolve, reject });

      // If batch is full, flush immediately
      if (this.batchQueue.length >= this.maxBatchSize) {
        this.clearBatchTimer();
        void this.flushBatch();
        return;
      }

      this.scheduleBatchFlush();
    });
  }

  private async flushBatch(): Promise<void> {
    if (this.flushInFlight) return;
    this.flushInFlight = true;
    try {
      while (this.batchQueue.length > 0) {
        const batch = this.batchQueue.splice(0, this.maxBatchSize);
        try {
          const texts = batch.map((item) => item.text);
          const vecs = await this.embedBatchDirect(texts);
          for (let index = 0; index < batch.length; index += 1) {
            batch[index]!.resolve(vecs[index]!);
          }
        } catch (err) {
          for (const item of batch) {
            item.reject(err);
          }
        }
      }
    } finally {
      this.flushInFlight = false;
      if (this.batchQueue.length > 0) {
        this.scheduleBatchFlush();
      }
    }
  }

  /**
   * Embed multiple texts in a single ONNX forward pass.
   * 3-8× faster than calling embed() N times sequentially.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embedBatchDirect(texts);
  }

  private async embedBatchDirect(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    if (texts.length === 1) {
      const single = await (
        pipe as (
          input: string,
          options: { pooling: string; normalize: boolean }
        ) => Promise<{ data: ArrayLike<number> }>
      )(texts[0]!, { pooling: "mean", normalize: true });
      return [Array.from(single.data)];
    }

    const result = await (
      pipe as (
        input: string[],
        options: { pooling: string; normalize: boolean }
      ) => Promise<{ dims: number[]; data: ArrayLike<number> }>
    )(texts, { pooling: "mean", normalize: true });

    const hiddenDim = result.dims[1];
    if (!hiddenDim || hiddenDim <= 0) {
      throw new Error(`LocalEmbedder invalid batch dims: ${JSON.stringify(result.dims)}`);
    }
    const flat = Array.from(result.data);
    const expected = texts.length * hiddenDim;
    if (flat.length < expected) {
      throw new Error(
        `LocalEmbedder invalid batch data length: got=${flat.length}, expected=${expected}`
      );
    }
    return texts.map((_, index) => flat.slice(index * hiddenDim, (index + 1) * hiddenDim));
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

  private scheduleBatchFlush(): void {
    if (this.batchTimer !== null) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      void this.flushBatch();
    }, this.batchWindowMs);
  }

  private clearBatchTimer(): void {
    if (this.batchTimer === null) return;
    clearTimeout(this.batchTimer);
    this.batchTimer = null;
  }
}
