import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JobOffer } from "../../src/shared/types.js";
import { SeenOffersStore } from "../../src/state/seen-offers-store.js";

const offer: JobOffer = {
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

describe("SeenOffersStore", () => {
  it("returns unseen offers and persists them once marked as seen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-state-"));
    const statePath = join(dir, "seen-offers.json");
    const store = new SeenOffersStore(statePath);

    await expect(store.getUnseenOffers([offer])).resolves.toEqual([offer]);

    await store.markSeen([offer]);

    await expect(store.getUnseenOffers([offer])).resolves.toEqual([]);
  });

  it("deduplicates offers by provider and provider offer id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-work-state-"));
    const statePath = join(dir, "seen-offers.json");
    const store = new SeenOffersStore(statePath);

    await store.markSeen([offer]);

    await expect(
      store.getUnseenOffers([
        offer,
        {
          ...offer,
          providerOfferId: "/jobs/next",
        },
      ]),
    ).resolves.toHaveLength(1);
  });
});
