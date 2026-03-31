import type { BlockId } from "../types.js";

/**
 * Expand a keyword token into CJK character bigrams so that Chinese keyword
 * retrieval works without a real word-segmenter.
 *
 * The main tokenizer splits Chinese text at punctuation/whitespace boundaries,
 * producing whole-phrase tokens like "所有写入操作抛出".  These long tokens
 * never match a query token like "搜索服务的文档为什么不能写入", even though
 * both contain the meaningful sub-token "写入".
 *
 * By indexing and querying on CJK bigrams we get character-level overlap:
 *   "所有写入操作抛出" → …"有写","写入","入操"…
 *   "不能写入"        → …"不能","能写","写入"
 *                              ↑ match!
 *
 * Only CJK runs (U+4E00–U+9FFF, U+3400–U+4DBF, U+F900–U+FAFF) are expanded;
 * Latin sub-tokens are returned unchanged.
 */
function expandCjkBigrams(token: string): string[] {
  const extra: string[] = [];
  let runStart = -1;
  for (let i = 0; i <= token.length; i++) {
    const code = token.codePointAt(i) ?? 0;
    const inCjk =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff);
    if (inCjk && runStart === -1) {
      runStart = i;
    } else if (!inCjk && runStart !== -1) {
      const run = token.slice(runStart, i);
      for (let j = 0; j < run.length - 1; j++) {
        extra.push(run.slice(j, j + 2));
      }
      runStart = -1;
    }
  }
  return extra;
}

export class InvertedIndex {
  private map = new Map<string, Set<BlockId>>();

  add(blockId: BlockId, keywords: string[]): void {
    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase();
      this._index(normalized, blockId);
      // Also index CJK bigrams so Chinese keyword matching works without a
      // word-segmenter.  Latin keywords are unchanged.
      for (const bigram of expandCjkBigrams(normalized)) {
        this._index(bigram, blockId);
      }
    }
  }

  private _index(key: string, blockId: BlockId): void {
    let ids = this.map.get(key);
    if (!ids) {
      ids = new Set<BlockId>();
      this.map.set(key, ids);
    }
    ids.add(blockId);
  }

  lookup(keywords: string[]): Set<BlockId> {
    if (keywords.length === 0) return new Set<BlockId>();
    const result = new Set<BlockId>();
    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase();
      // Direct lookup
      this._collect(normalized, result);
      // Also look up via CJK bigrams of this query keyword
      for (const bigram of expandCjkBigrams(normalized)) {
        this._collect(bigram, result);
      }
    }
    return result;
  }

  private _collect(key: string, out: Set<BlockId>): void {
    const ids = this.map.get(key);
    if (!ids) return;
    for (const id of ids) out.add(id);
  }

  remove(blockId: BlockId): void {
    for (const [key, ids] of this.map.entries()) {
      ids.delete(blockId);
      if (ids.size === 0) {
        this.map.delete(key);
      }
    }
  }
}
