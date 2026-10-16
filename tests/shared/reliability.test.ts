import { describe, expect, it, vi } from "vitest";
import { appConfigSchema } from "../../src/config/config.schema.js";
import { loadConfig } from "../../src/config/load-config.js";
import { DiscordNotifier } from "../../src/notifications/discord.notifier.js";
import { createHttpClient } from "../../src/shared/http-client.js";
import type { JobOffer } from "../../src/shared/types.js";

const offer: JobOffer = {
  provider: "free-work",
  providerOfferId: "synthetic",
  title: "x".repeat(1000),
  url: "https://example.test/jobs/1",
  company: null,
  location: "y".repeat(2000),
  publishedAt: null,
  contractTypes: [],
  dailyRate: { min: null, max: null },
  remote: "unknown",
  skills: [],
  description: null,
};

describe("network reliability and privacy", () => {
  it("does not retry a permanent HTTP error or expose private request data", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("secret body", { status: 403 }),
    );
    const warn = vi.fn();
    const client = createHttpClient({
      userAgent: "test",
      timeoutMs: 100,
      retryCount: 2,
      fetchImpl,
      logger: { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    });
    await expect(
      client(new URL("https://example.test/private-token?key=secret")),
    ).rejects.toThrow("status 403");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private-token|secret/);
  });
  it("honors bounded Retry-After and rejects excessive waits without retrying early", async () => {
    for (const seconds of [2, 120]) {
      const sleepImpl = vi.fn(async (_ms: number) => {});
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 429,
            headers: { "retry-after": String(seconds) },
          }),
        )
        .mockResolvedValue(new Response("ok"));
      const client = createHttpClient({
        userAgent: "test",
        timeoutMs: 100,
        retryCount: 1,
        fetchImpl,
        sleepImpl,
      });
      if (seconds === 2) {
        await expect(client(new URL("https://example.test"))).resolves.toBe(
          "ok",
        );
        expect(sleepImpl).toHaveBeenCalledWith(2000);
      } else {
        await expect(client(new URL("https://example.test"))).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(sleepImpl).not.toHaveBeenCalled();
      }
    }
  });
  it("bounds a Discord request and does not propagate an error containing its webhook", async () => {
    const notifier = new DiscordNotifier({
      webhookUrl: "https://example.test/secret-token",
      timeoutMs: 20,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("https://example.test/secret-token")),
          );
        }),
    });
    await expect(notifier.notify([offer])).rejects.toThrow(
      "Discord request failed or timed out",
    );
  });
  it("bounds Discord embeds and makes mentions opt-in", async () => {
    for (const mentionHere of [false, true]) {
      const payloads: Array<{
        content: string;
        embeds: Array<{ title: string; fields: Array<{ value: string }> }>;
        allowed_mentions: { parse: string[] };
      }> = [];
      const notifier = new DiscordNotifier({
        webhookUrl: "https://example.test/webhook",
        mentionHere,
        fetchImpl: async (_url, init) => {
          payloads.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 204 });
        },
      });
      await notifier.notify(Array.from({ length: 10 }, () => offer));
      expect(payloads).toHaveLength(1);
      const payload = payloads[0];
      expect(payload?.content.includes("@here")).toBe(mentionHere);
      expect(payload?.allowed_mentions.parse).toEqual(
        mentionHere ? ["everyone"] : [],
      );
      expect(payload?.embeds[0]?.title.length).toBe(256);
      expect(payload?.embeds[0]?.fields[0]?.value.length).toBe(128);
      expect(JSON.stringify(payload?.embeds).length).toBeLessThan(8000);
    }
  });
  it("refuses an excessive Discord retry delay", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: { "retry-after": "999999" },
        }),
    );
    const sleep = vi.fn(async () => {});
    const notifier = new DiscordNotifier({
      webhookUrl: "https://example.test/webhook",
      fetchImpl,
      sleep,
    });
    await expect(notifier.notify([offer])).rejects.toThrow(
      "retry delay exceeds limit",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("portable configuration", () => {
  it("validates the minimal distributed example without private files", async () => {
    const config = await loadConfig("config/config.example.yaml");
    expect(config.watchers).toHaveLength(1);
    expect(config.watchers[0]?.mentionHere).toBe(false);
  });
  it("requires providers only for enabled watchers and supports Pylote without Free-Work", async () => {
    const config = await loadConfig("config/config.example.yaml");
    const watcher = config.watchers[0];
    expect(
      appConfigSchema.safeParse({
        ...config,
        providers: {},
        watchers: [{ ...watcher, enabled: false, provider: "collective" }],
      }).success,
    ).toBe(true);
    expect(
      appConfigSchema.safeParse({
        ...config,
        providers: {},
        watchers: [{ ...watcher, provider: "free-work" }],
      }).success,
    ).toBe(false);
    expect(
      appConfigSchema.safeParse({
        ...config,
        providers: { pylote: { baseUrl: "https://example.test" } },
        watchers: [{ ...watcher, provider: "pylote" }],
      }).success,
    ).toBe(true);
  });
  it("rejects invalid schedules and credential-bearing or non-HTTP endpoints", async () => {
    const config = await loadConfig("config/config.example.yaml");
    for (const schedule of [
      { cron: "invalid", timezone: "UTC" },
      { cron: "* * * * *", timezone: "Moon/Base" },
    ])
      expect(appConfigSchema.safeParse({ ...config, schedule }).success).toBe(
        false,
      );
    for (const baseUrl of [
      "invalid",
      "file:///tmp/data",
      "https://user:secret@example.test",
    ])
      expect(
        appConfigSchema.safeParse({
          ...config,
          providers: { freeWork: { baseUrl } },
        }).success,
      ).toBe(false);
  });
});
