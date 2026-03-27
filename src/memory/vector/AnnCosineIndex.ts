import { cosineSimilarity } from "../../utils/text.js";

export interface AnnCosineIndexOptions {
  dimension: number;
  tableCount?: number;
  bitsPerTable?: number;
  probeRadius?: number;
}

export interface AnnSearchOptions {
  minScore?: number;
  candidateMultiplier?: number;
}

export interface AnnScoredRef {
  id: string;
  score: number;
}

export class AnnCosineIndex {
  private readonly dimension: number;
  private readonly tableCount: number;
  private readonly bitsPerTable: number;
  private readonly probeRadius: number;
  private readonly vectors = new Map<string, number[]>();
  private readonly tables: Array<Map<string, Set<string>>> = [];
  private readonly hyperplanes: number[][][] = [];

  constructor(options: AnnCosineIndexOptions) {
    const normalizedDimension = Number.isFinite(options.dimension)
      ? Math.floor(options.dimension)
      : 0;
    this.dimension = Math.max(1, normalizedDimension);
    this.tableCount = Math.max(2, options.tableCount ?? 6);
    this.bitsPerTable = Math.max(4, options.bitsPerTable ?? 12);
    this.probeRadius = Math.max(0, options.probeRadius ?? 1);

    for (let tableIndex = 0; tableIndex < this.tableCount; tableIndex += 1) {
      this.tables.push(new Map<string, Set<string>>());
      this.hyperplanes.push(this.createTableHyperplanes(tableIndex));
    }
  }

  upsert(id: string, vector: number[]): void {
    if (!id) return;
    if (!isValidVector(vector, this.dimension)) return;

    if (this.vectors.has(id)) {
      this.remove(id);
    }
    this.vectors.set(id, [...vector]);
    for (let tableIndex = 0; tableIndex < this.tableCount; tableIndex += 1) {
      const key = this.hashInTable(tableIndex, vector);
      const table = this.tables[tableIndex];
      const bucket = table.get(key) ?? new Set<string>();
      bucket.add(id);
      table.set(key, bucket);
    }
  }

  remove(id: string): void {
    const vector = this.vectors.get(id);
    if (!vector) return;

    for (let tableIndex = 0; tableIndex < this.tableCount; tableIndex += 1) {
      const key = this.hashInTable(tableIndex, vector);
      const table = this.tables[tableIndex];
      const bucket = table.get(key);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) {
        table.delete(key);
      }
    }
    this.vectors.delete(id);
  }

  clear(): void {
    this.vectors.clear();
    for (const table of this.tables) {
      table.clear();
    }
  }

  size(): number {
    return this.vectors.size;
  }

  search(query: number[], topK: number, options: AnnSearchOptions = {}): AnnScoredRef[] {
    if (!isValidVector(query, this.dimension)) return [];
    if (topK <= 0 || this.vectors.size === 0) return [];

    const minScore = options.minScore ?? -1;
    const candidateMultiplier = Math.max(1, Math.floor(options.candidateMultiplier ?? 8));
    const targetCandidates = Math.max(topK * candidateMultiplier, topK);

    const candidates = new Set<string>();
    for (let tableIndex = 0; tableIndex < this.tableCount; tableIndex += 1) {
      const table = this.tables[tableIndex];
      const key = this.hashInTable(tableIndex, query);
      collectBucket(table, key, candidates);
      if (candidates.size >= targetCandidates) continue;
      if (this.probeRadius <= 0) continue;
      for (const neighborKey of enumerateNeighborKeys(key, this.probeRadius)) {
        collectBucket(table, neighborKey, candidates);
        if (candidates.size >= targetCandidates) break;
      }
    }

    // Fallback to full scan if ANN buckets are empty.
    const targetIds = candidates.size > 0 ? candidates : new Set(this.vectors.keys());
    const scored: AnnScoredRef[] = [];
    for (const id of targetIds) {
      const vector = this.vectors.get(id);
      if (!vector) continue;
      const score = cosineSimilarity(query, vector);
      if (score < minScore) continue;
      scored.push({ id, score });
    }

    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.id.localeCompare(right.id);
    });
    return scored.slice(0, topK);
  }

  private createTableHyperplanes(tableIndex: number): number[][] {
    const table: number[][] = [];
    for (let bitIndex = 0; bitIndex < this.bitsPerTable; bitIndex += 1) {
      const plane: number[] = [];
      const seedBase = ((tableIndex + 1) * 73856093) ^ ((bitIndex + 1) * 19349663);
      for (let dimIndex = 0; dimIndex < this.dimension; dimIndex += 1) {
        const seed = seedBase ^ ((dimIndex + 1) * 83492791);
        const value = pseudoRandomUnit(seed);
        plane.push(value);
      }
      const norm = Math.sqrt(plane.reduce((sum, value) => sum + value * value, 0));
      table.push(norm > 0 ? plane.map((value) => value / norm) : plane);
    }
    return table;
  }

  private hashInTable(tableIndex: number, vector: number[]): string {
    const planes = this.hyperplanes[tableIndex];
    const bits = new Array(planes.length).fill("0");
    for (let bitIndex = 0; bitIndex < planes.length; bitIndex += 1) {
      const plane = planes[bitIndex];
      let dot = 0;
      for (let dimIndex = 0; dimIndex < this.dimension; dimIndex += 1) {
        dot += (vector[dimIndex] ?? 0) * (plane[dimIndex] ?? 0);
      }
      bits[bitIndex] = dot >= 0 ? "1" : "0";
    }
    return bits.join("");
  }
}

function isValidVector(vector: number[], expectedDimension: number): boolean {
  return vector.length === expectedDimension && vector.every((value) => Number.isFinite(value));
}

function collectBucket(table: Map<string, Set<string>>, key: string, output: Set<string>): void {
  const bucket = table.get(key);
  if (!bucket) return;
  for (const id of bucket) {
    output.add(id);
  }
}

function enumerateNeighborKeys(key: string, radius: number): string[] {
  if (radius <= 0) return [];
  const output: string[] = [];
  const chars = key.split("");
  for (let index = 0; index < chars.length; index += 1) {
    const clone = [...chars];
    clone[index] = clone[index] === "1" ? "0" : "1";
    output.push(clone.join(""));
  }
  return output;
}

function pseudoRandomUnit(seed: number): number {
  // Deterministic pseudo-random in [-1, 1].
  const value = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
  const frac = value - Math.floor(value);
  return frac * 2 - 1;
}
