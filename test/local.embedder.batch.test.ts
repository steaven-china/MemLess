import { afterEach, describe, expect, test, vi } from "vitest";

import { LocalEmbedder } from "../src/memory/embedder/LocalEmbedder.js";

interface PipelineMock {
  (text: string, options: { pooling: string; normalize: boolean }): Promise<{ data: ArrayLike<number> }>;
  (
    text: string[],
    options: { pooling: string; normalize: boolean }
  ): Promise<{ dims: number[]; data: ArrayLike<number> }>;
}

function clearPipelineCache(): void {
  const cache = (
    LocalEmbedder as unknown as { pipelineCache: Map<string, Promise<PipelineMock>> }
  ).pipelineCache;
  cache.clear();
}

function mockLoadPipeline(impl: () => Promise<PipelineMock>): void {
  vi.spyOn(
    LocalEmbedder.prototype as unknown as { loadPipeline: () => Promise<PipelineMock> },
    "loadPipeline"
  ).mockImplementation(impl);
}

describe("LocalEmbedder batching and backpressure", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearPipelineCache();
  });

  test("coalesces embed calls within the batch window", async () => {
    vi.useFakeTimers();
    const batchCalls: string[][] = [];
    const singleCalls: string[] = [];

    const pipeline = vi.fn(async (input: string | string[]) => {
      if (Array.isArray(input)) {
        batchCalls.push([...input]);
        return {
          dims: [input.length, 2],
          data: Float32Array.from(input.flatMap((_, index) => [index + 1, 0]))
        };
      }
      singleCalls.push(input);
      return { data: Float32Array.from([7, 7]) };
    }) as unknown as PipelineMock;

    mockLoadPipeline(async () => pipeline);

    const embedder = new LocalEmbedder({
      batchWindowMs: 10,
      maxBatchSize: 8,
      queueMaxPending: 16
    });

    const first = embedder.embed("alpha");
    const second = embedder.embed("beta");
    await vi.advanceTimersByTimeAsync(11);
    const [firstVec, secondVec] = await Promise.all([first, second]);

    expect(batchCalls).toEqual([["alpha", "beta"]]);
    expect(singleCalls).toEqual([]);
    expect(firstVec).toEqual([1, 0]);
    expect(secondVec).toEqual([2, 0]);
  });

  test("rejects when pending queue exceeds limit", async () => {
    vi.useFakeTimers();

    let releaseFirstBatch: (() => void) | undefined;
    let isFirstBatch = true;
    const pipeline = vi.fn(async (input: string | string[]) => {
      if (Array.isArray(input)) {
        if (isFirstBatch) {
          isFirstBatch = false;
          await new Promise<void>((resolve) => {
            releaseFirstBatch = resolve;
          });
        }
        return {
          dims: [input.length, 2],
          data: Float32Array.from(input.flatMap((_, index) => [index + 1, 0]))
        };
      }
      return { data: Float32Array.from([1, 0]) };
    }) as unknown as PipelineMock;

    mockLoadPipeline(async () => pipeline);

    const embedder = new LocalEmbedder({
      batchWindowMs: 50,
      maxBatchSize: 4,
      queueMaxPending: 5
    });

    const inFlight = Array.from({ length: 4 }, (_, index) => embedder.embed(`flight-${index + 1}`));
    await Promise.resolve();

    const queued = Array.from({ length: 5 }, (_, index) => embedder.embed(`queue-${index + 1}`));
    const overflow = embedder.embed("overflow");

    await expect(overflow).rejects.toThrow(/queue overflow/);
    expect(releaseFirstBatch).toBeTypeOf("function");

    releaseFirstBatch?.();
    await Promise.all(inFlight);

    await vi.advanceTimersByTimeAsync(51);
    await expect(Promise.all(queued)).resolves.toHaveLength(5);
  });

  test("retries pipeline load after a failure", async () => {
    let attempts = 0;
    const pipeline = vi.fn(async (input: string | string[]) => {
      if (Array.isArray(input)) {
        return {
          dims: [input.length, 2],
          data: Float32Array.from(input.flatMap((_, index) => [index + 1, 0]))
        };
      }
      return { data: Float32Array.from([1, 0]) };
    }) as unknown as PipelineMock;

    mockLoadPipeline(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("load failed");
      }
      return pipeline;
    });

    const embedder = new LocalEmbedder({
      batchWindowMs: 5,
      maxBatchSize: 4,
      queueMaxPending: 8
    });

    await expect(embedder.embedBatch(["x", "y"])).rejects.toThrow(/load failed/);
    const result = await embedder.embedBatch(["x", "y"]);
    expect(result).toEqual([
      [1, 0],
      [2, 0]
    ]);
    expect(attempts).toBe(2);
  });
});
