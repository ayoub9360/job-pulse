import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkNewOffers } from "../src/check-new-offers.js";
import type { Notifier } from "../src/notifications/notifier.js";
import type { JobProvider } from "../src/providers/provider.js";
import type { JobOffer, ProviderSearchFilters } from "../src/shared/types.js";
import { SeenOffersStore } from "../src/state/seen-offers-store.js";

const matchingOffer: JobOffer = {
  provider: "free-work",
  providerOfferId: "/jobs/react",
  title: "Developpeur React Senior",
  company: "ACME Conseil",
  url: "https://www.free-work.com/fr/tech-it/job-mission/react",
  publishedAt: null,
  contractTypes: ["freelance"],
  dailyRate: { min: 450, max: 600 },
  location: "Paris, France",
  remote: "partial",
  skills: ["React"],
  description: null,
};

const rejectedOffer: JobOffer = {
  ...matchingOffer,
  providerOfferId: "/jobs/php",
  title: "Developpeur PHP",
  skills: ["PHP"],
};

const filters: ProviderSearchFilters = {
  queries: ["react"],
  contracts: ["freelance"],
  minDailyRate: 400,
  remote: ["partial"],
  locations: ["Paris"],
  excludedKeywords: ["php"],
  maxPages: 1,
};

describe("checkNewOffers", () => {
  it("notifies only new matching offers and marks them as seen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-check-"));
    const seenOffersStore = new SeenOffersStore(join(dir, "seen-offers.json"));
    const notifiedOffers: JobOffer[] = [];
    const provider: JobProvider = {
      id: "free-work",
      search: async () => [matchingOffer, rejectedOffer],
    };
    const notifier: Notifier = {
      notify: async (offers) => {
        notifiedOffers.push(...offers);
      },
    };

    const firstSummary = await checkNewOffers({
      watchers: [
        {
          name: "frontend",
          provider,
          filters,
          notifiers: [notifier],
        },
      ],
      seenOffersStore,
    });
    const secondSummary = await checkNewOffers({
      watchers: [
        {
          name: "frontend",
          provider,
          filters,
          notifiers: [notifier],
        },
      ],
      seenOffersStore,
    });

    expect(firstSummary).toEqual({
      found: 2,
      matched: 1,
      unseen: 1,
      notified: 1,
    });
    expect(secondSummary.unseen).toBe(0);
    expect(notifiedOffers).toEqual([matchingOffer]);
  });

  it("does not replay successfully notified batches when a later batch fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-check-"));
    const seenOffersStore = new SeenOffersStore(join(dir, "seen-offers.json"));
    const offers = Array.from({ length: 11 }, (_, index) => ({
      ...matchingOffer,
      providerOfferId: `/jobs/react-${index}`,
      title: `Developpeur React Senior ${index}`,
    }));
    const provider: JobProvider = {
      id: "free-work",
      search: async () => offers,
    };
    let notificationCalls = 0;
    const flakyNotifier: Notifier = {
      notify: async (notifiedOffers) => {
        if (notifiedOffers.length > 10) {
          throw new Error("expected notification batches of at most 10 offers");
        }

        notificationCalls += 1;

        if (notificationCalls === 2) {
          throw new Error("rate limited");
        }
      },
    };

    await expect(
      checkNewOffers({
        watchers: [
          {
            name: "frontend",
            provider,
            filters,
            notifiers: [flakyNotifier],
          },
        ],
        seenOffersStore,
      }),
    ).rejects.toThrow("rate limited");

    const replayedOffers: JobOffer[] = [];

    const secondSummary = await checkNewOffers({
      watchers: [
        {
          name: "frontend",
          provider,
          filters,
          notifiers: [
            {
              notify: async (notifiedOffers) => {
                replayedOffers.push(...notifiedOffers);
              },
            },
          ],
        },
      ],
      seenOffersStore,
    });

    expect(secondSummary.unseen).toBe(1);
    expect(replayedOffers.map((offer) => offer.providerOfferId)).toEqual([
      "/jobs/react-10",
    ]);
  });

  it("keeps seen offers isolated by watcher", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-check-"));
    const seenOffersStore = new SeenOffersStore(join(dir, "seen-offers.json"));
    const provider: JobProvider = {
      id: "free-work",
      search: async () => [matchingOffer],
    };
    const frontendOffers: JobOffer[] = [];
    const backendOffers: JobOffer[] = [];

    await checkNewOffers({
      watchers: [
        {
          name: "frontend",
          provider,
          filters,
          notifiers: [
            {
              notify: async (offers) => {
                frontendOffers.push(...offers);
              },
            },
          ],
        },
      ],
      seenOffersStore,
    });

    const secondSummary = await checkNewOffers({
      watchers: [
        {
          name: "backend",
          provider,
          filters,
          notifiers: [
            {
              notify: async (offers) => {
                backendOffers.push(...offers);
              },
            },
          ],
        },
      ],
      seenOffersStore,
    });

    expect(frontendOffers).toEqual([matchingOffer]);
    expect(backendOffers).toEqual([matchingOffer]);
    expect(secondSummary).toEqual({
      found: 1,
      matched: 1,
      unseen: 1,
      notified: 1,
    });
  });

  it("limits notifications per run and leaves the rest queued", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-check-"));
    const seenOffersStore = new SeenOffersStore(join(dir, "seen-offers.json"));
    const offers = Array.from({ length: 25 }, (_, index) => ({
      ...matchingOffer,
      providerOfferId: `/jobs/react-${index}`,
      title: `Developpeur React Senior ${index}`,
    }));
    const provider: JobProvider = {
      id: "free-work",
      search: async () => offers,
    };
    const firstRunOffers: JobOffer[] = [];
    const secondRunOffers: JobOffer[] = [];

    const firstSummary = await checkNewOffers({
      maxNotificationsPerRun: 20,
      watchers: [
        {
          name: "frontend",
          provider,
          filters,
          notifiers: [
            {
              notify: async (notifiedOffers) => {
                firstRunOffers.push(...notifiedOffers);
              },
            },
          ],
        },
      ],
      seenOffersStore,
    });
    const secondSummary = await checkNewOffers({
      maxNotificationsPerRun: 20,
      watchers: [
        {
          name: "frontend",
          provider,
          filters,
          notifiers: [
            {
              notify: async (notifiedOffers) => {
                secondRunOffers.push(...notifiedOffers);
              },
            },
          ],
        },
      ],
      seenOffersStore,
    });

    expect(firstSummary).toEqual({
      found: 25,
      matched: 25,
      unseen: 25,
      notified: 20,
    });
    expect(secondSummary).toEqual({
      found: 25,
      matched: 25,
      unseen: 5,
      notified: 5,
    });
    expect(firstRunOffers.map((offer) => offer.providerOfferId)).toHaveLength(
      20,
    );
    expect(secondRunOffers.map((offer) => offer.providerOfferId)).toEqual([
      "/jobs/react-20",
      "/jobs/react-21",
      "/jobs/react-22",
      "/jobs/react-23",
      "/jobs/react-24",
    ]);
  });
});

it("continues other providers after a failed search without marking its offers seen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-failure-"));
  const store = new SeenOffersStore(join(dir, "seen.json"));
  const sent: JobOffer[] = [];
  const notifier: Notifier = {
    notify: async (offers) => {
      sent.push(...offers);
    },
  };
  const summary = await checkNewOffers({
    watchers: [
      {
        name: "frontend",
        provider: {
          id: "collective",
          search: async () => {
            throw new Error("Collective HTTP 403");
          },
        },
        filters,
        notifiers: [notifier],
      },
      {
        name: "frontend",
        provider: { id: "free-work", search: async () => [matchingOffer] },
        filters,
        notifiers: [notifier],
      },
    ],
    seenOffersStore: store,
  });
  expect(summary).toMatchObject({ failedSearches: 1, notified: 1 });
  expect(sent).toEqual([matchingOffer]);
  expect(
    await store.getUnseenOffers(
      [{ ...matchingOffer, provider: "collective" }],
      "frontend",
    ),
  ).toHaveLength(1);
});
