import { tokenize } from "../../utils/text.js";
import type { IEmbedder } from "./IEmbedder.js";

export class HashEmbedder implements IEmbedder {
  constructor(
    private readonly dimensions = 256,
    private readonly seed = 0
  ) {}

  embed(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = tokenize(text);
    if (tokens.length === 0) return vector;

    for (const token of tokens) {
      const hash = this.hash(token);
      vector[hash % this.dimensions] += 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) return vector;
    return vector.map((value) => value / norm);
  }

  private hash(text: string): number {
    let hash = this.seed | 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
