import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";

describe("loadConfig", () => {
  it("loads the synthetic regression config", async () => {
    const config = await loadConfig("tests/fixtures/watchers.yaml");

    expect(config.watchers.map((watcher) => watcher.name)).toEqual([
      "frontend",
      "data",
      "fullstack",
      "contracts",
      "groups",
    ]);
    expect(
      config.watchers.every((watcher) => watcher.locations.length === 0),
    ).toBe(true);
    expect(config.watchers[0]?.excludedKeywords).toContainEqual({
      keyword: "java",
      match: "whole-word",
    });
  });

  it("loads multiple watchers with their own filters and webhook env vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-config-"));
    const configPath = join(dir, "config.yaml");

    await writeFile(
      configPath,
      `
providers:
  freeWork:
    baseUrl: "https://www.free-work.com/fr/tech-it/jobs"
watchers:
  - name: frontend
    provider: free-work
    queries:
      - react
    webhookEnv: FRONTEND_DISCORD_WEBHOOK_URL
  - name: backend
    provider: free-work
    enabled: false
    queries:
      - node
    contracts:
      - freelance
    minDailyRate: 500
    remote:
      - full
    locations:
      - Paris
    excludedKeywords:
      - php
      - keyword: java
        match: whole-word
    maxPages: 3
    webhookEnv: BACKEND_DISCORD_WEBHOOK_URL
schedule:
  cron: "* * * * *"
  timezone: Europe/Paris
runtime:
  userAgent: "free-work-watcher/0.1"
`,
      "utf8",
    );

    const config = await loadConfig(configPath);

    expect(config.providers.freeWork?.baseUrl).toBe(
      "https://www.free-work.com/fr/tech-it/jobs",
    );
    expect(config.watchers).toEqual([
      {
        name: "frontend",
        provider: "free-work",
        enabled: true,
        queries: ["react"],
        requiredKeywordGroups: [],
        requiredKeywordScope: "offer",
        requiredTitleKeywords: [],
        contracts: [],
        minDailyRate: null,
        remote: [],
        locations: [],
        excludedKeywords: [],
        maxPages: 1,
        webhookEnv: "FRONTEND_DISCORD_WEBHOOK_URL",
      },
      {
        name: "backend",
        provider: "free-work",
        enabled: false,
        queries: ["node"],
        requiredKeywordGroups: [],
        requiredKeywordScope: "offer",
        requiredTitleKeywords: [],
        contracts: ["freelance"],
        minDailyRate: 500,
        remote: ["full"],
        locations: ["Paris"],
        excludedKeywords: ["php", { keyword: "java", match: "whole-word" }],
        maxPages: 3,
        webhookEnv: "BACKEND_DISCORD_WEBHOOK_URL",
      },
    ]);
    expect(config.runtime.requestTimeoutMs).toBe(10_000);
    expect(config.runtime.retryCount).toBe(1);
    expect(config.runtime.maxNotificationsPerRun).toBe(20);
  });

  it("loads Pylote watchers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-config-"));
    const configPath = join(dir, "config.yaml");

    await writeFile(
      configPath,
      `
providers:
  freeWork:
    baseUrl: "https://www.free-work.com/fr/tech-it/jobs"
  pylote:
    baseUrl: "https://api-prod.pylote.io"
watchers:
  - name: data
    provider: pylote
    queries:
      - data engineer
    contracts:
      - freelance
    minDailyRate: 450
    webhookEnv: DATA_DISCORD_WEBHOOK_URL
schedule:
  cron: "* * * * *"
runtime:
  userAgent: "free-work-watcher/0.1"
`,
      "utf8",
    );

    const config = await loadConfig(configPath);

    expect(config.providers.pylote?.baseUrl).toBe("https://api-prod.pylote.io");
    expect(config.watchers[0]?.provider).toBe("pylote");
  });

  it("rejects invalid configs with a readable message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-config-"));
    const configPath = join(dir, "config.yaml");

    await writeFile(
      configPath,
      `
providers:
  freeWork:
    baseUrl: "not-a-url"
watchers: []
schedule:
  cron: ""
runtime:
  userAgent: ""
`,
      "utf8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      /Invalid config.*providers\.freeWork\.baseUrl/s,
    );
  });

  it("rejects duplicate watcher names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-config-"));
    const configPath = join(dir, "config.yaml");

    await writeFile(
      configPath,
      `
providers:
  freeWork:
    baseUrl: "https://www.free-work.com/fr/tech-it/jobs"
watchers:
  - name: frontend
    provider: free-work
    queries:
      - react
    webhookEnv: FRONTEND_DISCORD_WEBHOOK_URL
  - name: frontend
    provider: free-work
    queries:
      - vue
    webhookEnv: VUE_DISCORD_WEBHOOK_URL
schedule:
  cron: "* * * * *"
runtime:
  userAgent: "free-work-watcher/0.1"
`,
      "utf8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      /Invalid config.*Watcher names must be unique/s,
    );
  });
});
