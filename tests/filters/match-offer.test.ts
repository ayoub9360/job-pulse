import { describe, expect, it } from "vitest";
import { matchOffer } from "../../src/filters/match-offer.js";
import type {
  JobOffer,
  ProviderSearchFilters,
} from "../../src/shared/types.js";

const baseOffer: JobOffer = {
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

const baseFilters: ProviderSearchFilters = {
  queries: ["react"],
  contracts: ["freelance"],
  minDailyRate: 400,
  remote: ["partial", "full"],
  locations: ["Paris"],
  excludedKeywords: ["php"],
  maxPages: 1,
};

describe("matchOffer", () => {
  it.each([
    ["Java", false],
    ["JAVA", false],
    ["Développeur Java senior", false],
    ["Java/Spring", false],
    ["(Java)", false],
    ["Java, React", false],
    ["React\nJava", false],
    ["Java-based", false],
    ["JavaScript", true],
    ["javascript", true],
    ["TypeScript", true],
    ["Java17", true],
    ["Java_foo", true],
    ["Javaé", true],
    ["Java字", true],
  ])("matches whole-word Java correctly in %s", (description, accepted) => {
    expect(
      matchOffer(
        { ...baseOffer, description },
        {
          ...baseFilters,
          excludedKeywords: [{ keyword: "java", match: "whole-word" }],
        },
      ),
    ).toBe(accepted);
  });

  it.each(["title", "company", "location", "description", "skills"] as const)(
    "applies whole-word exclusions to %s",
    (field) => {
      expect(
        matchOffer(
          {
            ...baseOffer,
            [field]: field === "skills" ? ["Java"] : "React Java",
          },
          {
            ...baseFilters,
            locations: [],
            excludedKeywords: [{ keyword: "java", match: "whole-word" }],
          },
        ),
      ).toBe(false);
    },
  );

  it.each([
    ["c++", "React C++", false],
    ["c++", "React C", true],
    [".net", "React .NET", false],
    [".net", "React internet", true],
    ["c#", "React C#", false],
    ["c#", "React Csharp", true],
  ])(
    "treats %s as a literal whole term in %s",
    (keyword, description, accepted) => {
      expect(
        matchOffer(
          { ...baseOffer, description },
          {
            ...baseFilters,
            excludedKeywords: [{ keyword, match: "whole-word" }],
          },
        ),
      ).toBe(accepted);
    },
  );

  it("preserves substring matching and supports mixing exclusion modes", () => {
    const offer = { ...baseOffer, description: "JavaScript et PHP8" };
    expect(
      matchOffer(offer, {
        ...baseFilters,
        excludedKeywords: [{ keyword: "java", match: "whole-word" }],
      }),
    ).toBe(true);
    for (const excludedKeywords of [
      ["java"],
      [{ keyword: "java", match: "substring" }],
      ["php", { keyword: "java", match: "whole-word" }],
    ] satisfies ProviderSearchFilters["excludedKeywords"][]) {
      expect(matchOffer(offer, { ...baseFilters, excludedKeywords })).toBe(
        false,
      );
    }
  });

  it("accepts locations outside France or unknown when no location filter is set", () => {
    for (const location of ["Bruxelles, Belgique", "Montréal, Canada", null]) {
      expect(
        matchOffer(
          { ...baseOffer, location },
          { ...baseFilters, locations: [] },
        ),
      ).toBe(true);
    }
  });

  it("keeps offers matching all configured filters", () => {
    expect(matchOffer(baseOffer, baseFilters)).toBe(true);
  });

  it("rejects offers below the configured daily rate", () => {
    expect(
      matchOffer(
        {
          ...baseOffer,
          dailyRate: { min: 300, max: 350 },
        },
        baseFilters,
      ),
    ).toBe(false);
  });

  it("keeps offers with unknown daily rate even when a minimum daily rate is configured", () => {
    expect(
      matchOffer(
        {
          ...baseOffer,
          dailyRate: { min: null, max: null },
        },
        baseFilters,
      ),
    ).toBe(true);
  });

  it("keeps offers when location filters are Free-Work provider codes", () => {
    expect(
      matchOffer(baseOffer, {
        ...baseFilters,
        locations: ["fr~~~"],
      }),
    ).toBe(true);
  });

  it("rejects offers containing excluded keywords", () => {
    expect(
      matchOffer(
        {
          ...baseOffer,
          description: "Maintenance d'une application PHP legacy.",
        },
        baseFilters,
      ),
    ).toBe(false);
  });

  it("rejects offers outside selected remote modes or locations", () => {
    expect(matchOffer({ ...baseOffer, remote: "onsite" }, baseFilters)).toBe(
      false,
    );
    expect(
      matchOffer({ ...baseOffer, location: "Lyon, France" }, baseFilters),
    ).toBe(false);
  });
});
