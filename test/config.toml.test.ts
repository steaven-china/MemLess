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

  test("loads low entropy trigger config from toml file", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[manager]",
        "lowEntropyTriggerEnabled = true",
        "lowEntropyWindowSize = 7",
        "lowEntropyMinSignals = 2",
        "lowEntropyNoveltyMax = 0.21",
        "lowEntropyRetrievalOverlapMin = 0.71",
        "lowEntropyPredictionWeightMax = 0.03",
        "lowEntropyRelationNewRateMax = 0.19",
        "lowEntropyGraphCoverageMax = 0.29",
        "lowEntropyRelationConfidenceMax = 0.31",
        "lowEntropySoftStreakK = 2",
        "lowEntropyHardStreakK = 5",
        "lowEntropySoftCooldownSeconds = 320",
        "lowEntropyHardCooldownSeconds = 930"
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.manager.lowEntropyTriggerEnabled).toBe(true);
    expect(config.manager.lowEntropyWindowSize).toBe(7);
    expect(config.manager.lowEntropyMinSignals).toBe(2);
    expect(config.manager.lowEntropyNoveltyMax).toBe(0.21);
    expect(config.manager.lowEntropyRetrievalOverlapMin).toBe(0.71);
    expect(config.manager.lowEntropyPredictionWeightMax).toBe(0.03);
    expect(config.manager.lowEntropyRelationNewRateMax).toBe(0.19);
    expect(config.manager.lowEntropyGraphCoverageMax).toBe(0.29);
    expect(config.manager.lowEntropyRelationConfidenceMax).toBe(0.31);
    expect(config.manager.lowEntropySoftStreakK).toBe(2);
    expect(config.manager.lowEntropyHardStreakK).toBe(5);
    expect(config.manager.lowEntropySoftCooldownSeconds).toBe(320);
    expect(config.manager.lowEntropyHardCooldownSeconds).toBe(930);
  });

  test("throws on invalid low entropy trigger type", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, ["[manager]", 'lowEntropyWindowSize = "7"'].join("\n"), "utf8");

    expect(() => loadConfig({}, { userTomlPath: filePath })).toThrowError(
      new RegExp(`manager\\.lowEntropyWindowSize must be number`)
    );
  });

  test("loads relation trigger config from toml file", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[manager]",
        "relationTriggerEnabled = true",
        "relationTriggerWindowSize = 50",
        "relationTriggerStreakRequired = 3",
        "relationTriggerCooldownSeconds = 900",
        "relationTriggerLowInfoThreshold = 0.25",
        "relationTriggerHighEntropyThreshold = 0.75",
        "relationTriggerShortChainMaxSize = 2",
        "relationMinConfidence = 0.35",
        "relationCandidatePromoteScore = 0.65",
        "relationCandidateDecay = 0.85",
        "relationConflictDetectionEnabled = true"
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig({}, { userTomlPath: filePath });
    expect(config.manager.relationTriggerEnabled).toBe(true);
    expect(config.manager.relationTriggerWindowSize).toBe(50);
    expect(config.manager.relationTriggerStreakRequired).toBe(3);
    expect(config.manager.relationTriggerCooldownSeconds).toBe(900);
    expect(config.manager.relationTriggerLowInfoThreshold).toBe(0.25);
    expect(config.manager.relationTriggerHighEntropyThreshold).toBe(0.75);
    expect(config.manager.relationTriggerShortChainMaxSize).toBe(2);
    expect(config.manager.relationMinConfidence).toBe(0.35);
    expect(config.manager.relationCandidatePromoteScore).toBe(0.65);
    expect(config.manager.relationCandidateDecay).toBe(0.85);
    expect(config.manager.relationConflictDetectionEnabled).toBe(true);
  });

  test("throws on invalid relation trigger type", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, ["[manager]", 'relationTriggerShortChainMaxSize = "2"'].join("\n"), "utf8");

    expect(() => loadConfig({}, { userTomlPath: filePath })).toThrowError(
      new RegExp(`manager\\.relationTriggerShortChainMaxSize must be number`)
    );
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
