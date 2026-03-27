import { promises as fs } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";

export interface ReadonlyFileServiceConfig {
  rootPath: string;
  maxReadBytes?: number;
  maxListEntries?: number;
}

export interface ReadonlyFileEntry {
  path: string;
  type: "file" | "dir" | "other";
  sizeBytes?: number;
  modifiedAt?: number;
}

export interface ReadFileResult {
  path: string;
  text: string;
  bytes: number;
  totalBytes: number;
  truncated: boolean;
  modifiedAt?: number;
}

export class ReadonlyFileService {
  private readonly rootPath: string;
  private readonly maxReadBytes: number;
  private readonly maxListEntries: number;

  constructor(config: ReadonlyFileServiceConfig) {
    this.rootPath = resolve(config.rootPath);
    this.maxReadBytes = config.maxReadBytes ?? 64 * 1024;
    this.maxListEntries = config.maxListEntries ?? 200;
  }

  async list(pathInput = ".", maxEntries?: number): Promise<ReadonlyFileEntry[]> {
    const resolved = this.resolveWithinRoot(pathInput);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved.relativePath}`);
    }

    const dirents = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
    const sorted = [...dirents].sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1;
      if (!left.isDirectory() && right.isDirectory()) return 1;
      return left.name.localeCompare(right.name);
    });

    const limit = Math.max(1, Math.min(maxEntries ?? this.maxListEntries, 2000));
    const selected = sorted.slice(0, limit);
    const entries = await Promise.all(
      selected.map(async (dirent) => {
        const joinedPath =
          resolved.relativePath === "."
            ? dirent.name
            : `${resolved.relativePath}/${dirent.name}`.replace(/\\/g, "/");
        const absolute = resolve(this.rootPath, joinedPath);
        let sizeBytes: number | undefined;
        let modifiedAt: number | undefined;
        try {
          const itemStat = await fs.stat(absolute);
          modifiedAt = itemStat.mtimeMs;
          if (dirent.isFile()) {
            sizeBytes = itemStat.size;
          }
        } catch {
          sizeBytes = undefined;
          modifiedAt = undefined;
        }

        return {
          path: joinedPath.replace(/\\/g, "/"),
          type: dirent.isDirectory() ? "dir" : dirent.isFile() ? "file" : "other",
          sizeBytes,
          modifiedAt
        } satisfies ReadonlyFileEntry;
      })
    );

    return entries;
  }

  async read(pathInput: string, maxBytes?: number): Promise<ReadFileResult> {
    const resolved = this.resolveWithinRoot(pathInput);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${resolved.relativePath}`);
    }

    const content = await fs.readFile(resolved.absolutePath);
    const limit = Math.max(1, Math.min(maxBytes ?? this.maxReadBytes, 2 * 1024 * 1024));
    const truncated = content.byteLength > limit;
    const payload = truncated ? content.subarray(0, limit) : content;

    return {
      path: resolved.relativePath,
      text: payload.toString("utf8"),
      bytes: payload.byteLength,
      totalBytes: content.byteLength,
      truncated,
      modifiedAt: stat.mtimeMs
    };
  }

  private resolveWithinRoot(pathInput: string): { absolutePath: string; relativePath: string } {
    const requestedPath = pathInput.trim().length > 0 ? pathInput.trim() : ".";
    const absolutePath = resolve(this.rootPath, requestedPath);
    const relativePath = relative(this.rootPath, absolutePath);
    const outsideRoot = relativePath.startsWith("..") || isAbsolute(relativePath);
    if (outsideRoot) {
      throw new Error(`Path escapes readonly root: ${requestedPath}`);
    }
    const normalized = relativePath.length > 0 ? relativePath.replace(/\\/g, "/") : ".";
    return { absolutePath, relativePath: normalized };
  }
}
