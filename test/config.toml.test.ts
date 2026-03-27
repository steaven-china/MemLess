import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];

async function makeTempPath(fileName = "config.toml"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mlex-config-test-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("loadConfig with ~/.mlex/config.toml support", () => {
  test("skips missing toml file", () => {
    const missingPath = path.join(tmpdir(), `mlex-missing-${Date.now()}.toml`);
    const config = loadConfig({}, { userTomlPath: missingPath });
    expect(config.service.provider).toBe("rule-based");
  });

  test("loads values from toml file", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[service]",
        'provider = "deepseek-reasoner"',
        "",
        "[manager]",
        "searchTopK = 9",
        "",
        "[component]",
        "searchSeedQueries = [\"alpha\", \"beta\"]"
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.service.provider).toBe("deepseek-reasoner");
    expect(config.manager.searchTopK).toBe(9);
    expect(config.component.searchSeedQueries).toEqual(["alpha", "beta"]);
  });

  test("applies overrides above toml values", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[service]",
        'provider = "rule-based"',
        "",
        "[manager]",
        "searchTopK = 3"
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig(
      {
        service: { provider: "openai" },
        manager: { searchTopK: 12 }
      },
      { userTomlPath: filePath }
    );

    expect(config.service.provider).toBe("openai");
    expect(config.manager.searchTopK).toBe(12);
  });

  test("keeps toml values higher than env vars", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      ["[environment]", 'logLevel = "debug"'].join("\n"),
      "utf8"
    );

    const previousLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    try {
      const config = loadConfig({}, { userTomlPath: filePath });
      expect(config.environment.logLevel).toBe("debug");
    } finally {
      if (previousLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = previousLogLevel;
      }
    }
  });

  test("loads tagger config from toml file", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[component]",
        'tagger = "deepseek"',
        'taggerModel = "deepseek-chat"',
        "taggerTimeoutMs = 7000",
        "taggerImportantThreshold = 0.75"
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.component.tagger).toBe("deepseek");
    expect(config.component.taggerModel).toBe("deepseek-chat");
    expect(config.component.taggerTimeoutMs).toBe(7000);
    expect(config.component.taggerImportantThreshold).toBe(0.75);
  });

  test("throws on invalid toml syntax", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, "[service\nprovider = \"openai\"", "utf8");

    expect(() => loadConfig({}, { userTomlPath: filePath })).toThrowError(
      new RegExp(`Failed to parse TOML config at ${escapeRegex(filePath)}`)
    );
  });

  test("throws on invalid toml value type", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, ["[manager]", 'searchTopK = "abc"'].join("\n"), "utf8");

    expect(() => loadConfig({}, { userTomlPath: filePath })).toThrowError(
      new RegExp(`manager\\.searchTopK must be number`)
    );
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
