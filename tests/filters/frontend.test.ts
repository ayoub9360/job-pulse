import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";
import { matchOffer } from "../../src/filters/match-offer.js";
import type {
  JobOffer,
  ProviderSearchFilters,
} from "../../src/shared/types.js";

const { offers }: { offers: Array<JobOffer & { accepted: boolean }> } =
  JSON.parse(
    readFileSync(
      "tests/fixtures/free-work-frontend-false-positives.json",
      "utf8",
    ),
  );
const firstOffer = offers[0];
if (!firstOffer) throw new Error("Missing regression fixture");
const baseOffer: JobOffer = firstOffer;
let filters: ProviderSearchFilters;
beforeAll(async () => {
  const config = await loadConfig("tests/fixtures/watchers.yaml");
  const watcher = config.watchers.find((entry) => entry.name === "frontend");
  if (!watcher) throw new Error("Missing frontend watcher");
  filters = watcher;
});

describe("frontend relevance", () => {
  it.each(offers.map((offer) => [offer.title, offer] as const))(
    "classifies the reported offer %s",
    (_title, offer) => {
      expect(matchOffer(offer, filters)).toBe(offer.accepted);
    },
  );

  it.each([
    "en vue de",
    "point de vue",
    "revues de code",
    "sans dépendance à React",
    "Vue.js cité comme contexte",
  ])(
    "does not treat description-only %s as a declared frontend stack",
    (description) => {
      const offer = {
        ...baseOffer,
        title: "Développeur web",
        skills: ["HTML", "CSS"],
        description,
      };
      expect(matchOffer(offer, filters)).toBe(false);
    },
  );

  it.each([
    "React",
    "ReactJS",
    "React.js",
    "Next",
    "NextJS",
    "Next.js",
    "Vue",
    "VueJS",
    "Vue.js",
    "Nuxt",
    "NuxtJS",
    "Nuxt.js",
  ])("accepts frontend framework %s as a declared skill", (framework) => {
    expect(
      matchOffer(
        {
          ...baseOffer,
          title: "Développeur frontend",
          skills: [framework],
          description: null,
        },
        filters,
      ),
    ).toBe(true);
  });

  it("does not use the employer name to satisfy the framework requirement", () => {
    expect(
      matchOffer(
        {
          ...baseOffer,
          title: "Développeur web",
          company: "Next Consulting",
          skills: [],
          description: null,
        },
        filters,
      ),
    ).toBe(false);
  });

  it("keeps 400–500 euros and rejects 400–440 euros", () => {
    expect(
      matchOffer({ ...baseOffer, dailyRate: { min: 400, max: 500 } }, filters),
    ).toBe(true);
    expect(
      matchOffer({ ...baseOffer, dailyRate: { min: 400, max: 440 } }, filters),
    ).toBe(false);
  });
});
