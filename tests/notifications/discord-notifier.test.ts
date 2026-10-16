import { describe, expect, it } from "vitest";
import { DiscordNotifier } from "../../src/notifications/discord.notifier.js";
import type { AppLogger } from "../../src/shared/logger.js";
import type { JobOffer } from "../../src/shared/types.js";

const offer: JobOffer = {
  provider: "free-work",
  providerOfferId: "/jobs/react",
  title: "Developpeur React Senior",
  company: "ACME Conseil",
  url: "https://www.free-work.com/fr/tech-it/job-mission/react",
  publishedAt: new Date("2026-07-06T00:00:00.000Z"),
  contractTypes: ["freelance"],
  dailyRate: { min: 450, max: 600 },
  location: "Paris, France",
  remote: "partial",
  skills: ["React", "TypeScript"],
  description: "Mission longue sur une application front critique.",
};

describe("DiscordNotifier", () => {
  it.each([
    [{ min: 400, max: 500 }, "400–500 €/jour"],
    [{ min: 550, max: 550 }, "550 €/jour"],
    [{ min: 450, max: null }, "À partir de 450 €/jour"],
    [{ min: null, max: 600 }, "Jusqu’à 600 €/jour"],
    [{ min: null, max: null }, "TJM inconnu"],
  ] as const)("formats daily rate %j", async (dailyRate, expected) => {
    const bodies: string[] = [];
    const notifier = new DiscordNotifier({
      webhookUrl: "https://discord.test/local",
      fetchImpl: async (_url, init) => {
        bodies.push(String(init?.body));
        return new Response(null, { status: 204 });
      },
    });
    await notifier.notify([{ ...offer, dailyRate }]);
    expect(JSON.parse(String(bodies[0])).embeds[0].fields).toContainEqual({
      name: "💰 TJM",
      value: expected,
      inline: true,
    });
  });

  it("posts Discord embeds in batches", async () => {
    const requests: RequestInit[] = [];
    const notifier = new DiscordNotifier({
      webhookUrl: "https://discord.com/api/webhooks/test",
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        return new Response(null, { status: 204 });
      },
    });

    await notifier.notify([
      offer,
      {
        ...offer,
        providerOfferId: "/jobs/vue",
        title: "Developpeur Vue Senior",
        url: "https://www.free-work.com/fr/tech-it/job-mission/vue",
      },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers).toEqual({
      "content-type": "application/json",
    });
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      content: "",
      embeds: [
        {
          title: "Developpeur React Senior",
          url: "https://www.free-work.com/fr/tech-it/job-mission/react",
          color: 5763719,
          fields: [
            {
              name: "📍 Localisation",
              value: "Paris, France",
              inline: true,
            },
            {
              name: "💰 TJM",
              value: "450–600 €/jour",
              inline: true,
            },
            {
              name: "💻 Remote",
              value: "Teletravail partiel",
              inline: true,
            },
          ],
          footer: {
            text: "Free-Work",
          },
        },
        {
          title: "Developpeur Vue Senior",
          url: "https://www.free-work.com/fr/tech-it/job-mission/vue",
          color: 5763719,
          fields: [
            {
              name: "📍 Localisation",
              value: "Paris, France",
              inline: true,
            },
            {
              name: "💰 TJM",
              value: "450–600 €/jour",
              inline: true,
            },
            {
              name: "💻 Remote",
              value: "Teletravail partiel",
              inline: true,
            },
          ],
          footer: {
            text: "Free-Work",
          },
        },
      ],
      allowed_mentions: {
        parse: [],
      },
    });
  });

  it("retries Discord rate limits after the requested delay", async () => {
    const requests: RequestInit[] = [];
    const delays: number[] = [];
    const warnings: Array<{
      context: Record<string, unknown>;
      message: string;
    }> = [];
    const notifier = new DiscordNotifier({
      webhookUrl: "https://discord.com/api/webhooks/test",
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});

        if (requests.length === 1) {
          return new Response(null, {
            status: 429,
            headers: {
              "retry-after": "0.25",
            },
          });
        }

        return new Response(null, { status: 204 });
      },
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: (context, message) => {
          warnings.push({ context, message });
        },
        error: () => undefined,
      } as AppLogger,
    });

    await notifier.notify([offer]);

    expect(requests).toHaveLength(2);
    expect(delays).toEqual([250]);
    expect(warnings).toEqual([
      {
        context: {
          attempt: 1,
          delayMs: 250,
          maxAttempts: 3,
          status: 429,
        },
        message: "discord rate limited; retrying",
      },
    ]);
  });

  it("does not call Discord when there are no offers", async () => {
    let calls = 0;
    const notifier = new DiscordNotifier({
      webhookUrl: "https://discord.com/api/webhooks/test",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    });

    await notifier.notify([]);

    expect(calls).toBe(0);
  });
});
