import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ReadonlyFileService } from "../src/files/ReadonlyFileService.js";

describe("ReadonlyFileService", () => {
  test("lists directory entries in readonly mode", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-files-list-"));
    await fs.mkdir(join(folder, "notes"));
    await fs.writeFile(join(folder, "readme.txt"), "hello", "utf8");

    const service = new ReadonlyFileService({ rootPath: folder });
    const entries = await service.list(".");
    const paths = entries.map((entry) => entry.path);

    expect(paths).toContain("notes");
    expect(paths).toContain("readme.txt");
  });

  test("reads file with truncation metadata", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-files-read-"));
    const filePath = join(folder, "big.txt");
    await fs.writeFile(filePath, "abcdefghij", "utf8");

    const service = new ReadonlyFileService({ rootPath: folder });
    const result = await service.read("big.txt", 4);
    expect(result.path).toBe("big.txt");
    expect(result.text).toBe("abcd");
    expect(result.bytes).toBe(4);
    expect(result.totalBytes).toBe(10);
    expect(result.truncated).toBe(true);
    expect(typeof result.modifiedAt).toBe("number");
  });

  test("blocks path traversal outside root", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-files-root-"));
    const service = new ReadonlyFileService({ rootPath: folder });

    await expect(service.read("../outside.txt")).rejects.toThrow("Path escapes readonly root");
  });
});
