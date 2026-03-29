import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "../src/config.js";
import { ensureDefaultUserConfigFiles } from "../src/config/toml.js";

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

  test("creates default config and tags files when missing", async () => {
    const filePath = await makeTempPath();
    const tagsPath = path.join(path.dirname(filePath), "tags.toml");

    ensureDefaultUserConfigFiles({ configFilePath: filePath });
    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.service.provider).toBe("rule-based");

    const configSource = await readFile(filePath, "utf8");
    expect(configSource).toContain("[service]");
    expect(configSource).toContain('provider = "rule-based"');

    const tagsSource = await readFile(tagsPath, "utf8");
    expect(tagsSource).toContain("[docs]");
    expect(tagsSource).toContain("[vars]");
  });

  test("does not overwrite existing config file", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, ["[service]", 'provider = "openai"'].join("\n"), "utf8");

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.service.provider).toBe("openai");

    const source = await readFile(filePath, "utf8");
    expect(source).toContain('provider = "openai"');
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
        "taggerImportantThreshold = 0.75",
        'allowedAiTags = ["critical", "normal", "ops"]'
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.component.tagger).toBe("deepseek");
    expect(config.component.taggerModel).toBe("deepseek-chat");
    expect(config.component.taggerTimeoutMs).toBe(7000);
    expect(config.component.taggerImportantThreshold).toBe(0.75);
    expect(config.component.allowedAiTags).toEqual(["critical", "normal", "ops"]);
  });

  test("loads tags intro config from toml file", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[component]",
        "includeTagsIntro = false",
        'tagsIntroPath = "AgentDocs/TagsIntro.md"',
        'tagsTomlPath = "~/.mlex/tags.toml"',
        "",
        "[component.tagsTemplateVars]",
        'team = "search"',
        'owner = "ops"'
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.component.includeTagsIntro).toBe(false);
    expect(config.component.tagsIntroPath).toBe("AgentDocs/TagsIntro.md");
    expect(config.component.tagsTomlPath).toBe("~/.mlex/tags.toml");
    expect(config.component.tagsTemplateVars).toEqual({ team: "search", owner: "ops" });
  });

  test("throws on invalid tagsTemplateVars value type", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, ["[component.tagsTemplateVars]", "team = 1"].join("\n"), "utf8");

    expect(() => loadConfig({}, { userTomlPath: filePath })).toThrowError(
      /component\.tagsTemplateVars must be table<string>/
    );
  });

  test("throws on invalid tags intro boolean type", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, ["[component]", 'includeTagsIntro = "true"'].join("\n"), "utf8");

    expect(() => loadConfig({}, { userTomlPath: filePath })).toThrowError(
      /component\.includeTagsIntro must be boolean/
    );
  });

  test("loads prediction rerank tuning config from toml file", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[manager]",
        "predictionDenseBoostMultiplier = 0.031",
        "predictionBoostCap = 0.16",
        "predictionBaseScoreGateMax = 0.12",
        "predictionDenseConfidenceGateMin = 0.55"
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.manager.predictionDenseBoostMultiplier).toBe(0.031);
    expect(config.manager.predictionBoostCap).toBe(0.16);
    expect(config.manager.predictionBaseScoreGateMax).toBe(0.12);
    expect(config.manager.predictionDenseConfidenceGateMin).toBe(0.55);
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
