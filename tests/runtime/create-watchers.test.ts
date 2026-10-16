import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config/config.schema.js";
import type { Notifier } from "../../src/notifications/notifier.js";
import type { JobProvider } from "../../src/providers/provider.js";
import { createWatchers } from "../../src/runtime/create-watchers.js";

const freeWorkProvider: JobProvider = {
  id: "free-work",
  search: async () => [],
};
const pyloteProvider: JobProvider = {
  id: "pylote",
  search: async () => [],
};

const config: AppConfig = {
  providers: {
    freeWork: {
      baseUrl: "https://www.free-work.com/fr/tech-it/jobs",
    },
    pylote: {
      baseUrl: "https://api-prod.pylote.io",
    },
  },
  watchers: [
    {
      name: "frontend",
      provider: "free-work",
      enabled: true,
      queries: ["react"],
      requiredKeywordGroups: [],
      requiredKeywordScope: "offer",
      requiredTitleKeywords: [],
      contracts: ["freelance"],
      minDailyRate: 450,
      remote: ["partial"],
      locations: ["Paris"],
      excludedKeywords: ["php"],
      maxPages: 2,
      webhookEnv: "FRONTEND_DISCORD_WEBHOOK_URL",
    },
    {
      name: "backend",
      provider: "pylote",
      enabled: true,
      queries: ["node"],
      requiredKeywordGroups: [],
      requiredKeywordScope: "offer",
      requiredTitleKeywords: [],
      contracts: [],
      minDailyRate: null,
      remote: [],
      locations: [],
      excludedKeywords: [],
      maxPages: 1,
      webhookEnv: "BACKEND_DISCORD_WEBHOOK_URL",
    },
  ],
  schedule: {
    cron: "* * * * *",
    timezone: "Europe/Paris",
  },
  runtime: {
    userAgent: "Mozilla/5.0",
    requestTimeoutMs: 10_000,
    retryCount: 1,
    maxNotificationsPerRun: 20,
  },
};

describe("createWatchers", () => {
  it("creates one watcher per enabled config with its own Discord webhook env var", () => {
    const webhookUrls: string[] = [];

    const watchers = createWatchers({
      config,
      env: {
        FRONTEND_DISCORD_WEBHOOK_URL: "https://discord.test/frontend",
        BACKEND_DISCORD_WEBHOOK_URL: "https://discord.test/backend",
      },
      providersById: {
        "free-work": freeWorkProvider,
        pylote: pyloteProvider,
      },
      createNotifier: ({ webhookUrl }): Notifier => {
        webhookUrls.push(webhookUrl);

        return {
          notify: async () => undefined,
        };
      },
    });

    expect(watchers.map((watcher) => watcher.name)).toEqual([
      "frontend",
      "backend",
    ]);
    expect(watchers.map((watcher) => watcher.filters.queries)).toEqual([
      ["react"],
      ["node"],
    ]);
    expect(watchers.map((watcher) => watcher.provider.id)).toEqual([
      "free-work",
      "pylote",
    ]);
    expect(webhookUrls).toEqual([
      "https://discord.test/frontend",
      "https://discord.test/backend",
    ]);
  });
});
