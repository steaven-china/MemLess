import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface TestRunDir {
  runDir: string;
  sqliteFile: string;
  timestamp: string;
}

export async function createTestRunDir(testName: string): Promise<TestRunDir> {
  const sanitizedTestName = sanitizeTestName(testName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(process.cwd(), ".mlex", "test", sanitizedTestName, timestamp);
  await mkdir(runDir, { recursive: true });
  return {
    runDir,
    sqliteFile: join(runDir, "memory.db"),
    timestamp
  };
}

function sanitizeTestName(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "unnamed-test";
  return normalized
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "unnamed-test";
}
