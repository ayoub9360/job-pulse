import { describe, expect, it, vi } from "vitest";
import { matchOffer } from "../../../src/filters/match-offer.js";
import {
  type CollectiveProject,
  parseCollectiveProject,
  parseCollectiveRate,
} from "../../../src/providers/collective/collective.parser.js";
import { CollectiveProvider } from "../../../src/providers/collective/collective.provider.js";
import type { ProviderSearchFilters } from "../../../src/shared/types.js";

const project: CollectiveProject = {
  id: "one",
  slug: "react-node",
  name: "Développeur fullstack React Node.js",
  contractTypes: ["FREELANCE"],
};
const filters: ProviderSearchFilters = {
  queries: ["react"],
  contracts: ["freelance"],
  minDailyRate: 450,
  remote: [],
  locations: [],
  excludedKeywords: [{ keyword: "java", match: "whole-word" }],
  maxPages: 2,
};
const response = (projects: CollectiveProject[], total = 100) => ({
  data: { results: { projects, pagination: { from: 0, total } } },
});

describe("Collective parser", () => {
  it.each([
    ["400-500", 400, 500],
    ["400-450e", 400, 450],
    ["600 - 700", 600, 700],
    ["550–600 €", 550, 600],
    ["395", 395, 395],
    ["525€ / jour", 525, 525],
    ["450,50 EUR/jour", 450.5, 450.5],
    ["Fourchette proposée par le client : 400 à 500 € HT de TJM", 400, 500],
    ["À partir de 450 €", 450, null],
    ["Jusqu’à 600 €", null, 600],
    ["600-500", 500, 600],
    ["0", null, null],
    [null, null, null],
    ["Selon profil", null, null],
    ["40k-45k", null, null],
    ["5000 €/mois", null, null],
    ["80 €/heure", null, null],
    ["500 USD", null, null],
    ["600 CHF/jour", null, null],
    ["500 $", null, null],
    ["60000", null, null],
    ["Mission de 6 mois", null, null],
  ])("parses budget %s", (budgetBrief, min, max) => {
    expect(parseCollectiveRate({ ...project, budgetBrief })).toEqual({
      min,
      max,
    });
  });
  it("never interprets an annual wage as a daily rate", () => {
    expect(
      parseCollectiveRate({
        ...project,
        minSalary: 45000,
        maxSalary: 60000,
        salaryFrequency: "PER_YEAR",
        budgetBrief: "500",
      }),
    ).toEqual({ min: null, max: null });
    expect(
      parseCollectiveRate({
        ...project,
        contractTypes: ["FULL_TIME"],
        budgetBrief: "500",
      }),
    ).toEqual({ min: null, max: null });
  });
  it("uses structured daily EUR rates and preserves one-sided ranges", () => {
    expect(
      parseCollectiveRate({
        ...project,
        minSalary: 450,
        salaryFrequency: "PER_DAY",
        salaryCurrency: "EUR",
      }),
    ).toEqual({ min: 450, max: null });
    expect(
      parseCollectiveRate({
        ...project,
        maxSalary: 600,
        salaryFrequency: "Daily",
        salaryCurrency: "USD",
      }),
    ).toEqual({ min: null, max: null });
  });
  it.each([
    [[], "unknown"],
    [["REMOTE"], "full"],
    [["HYBRID"], "partial"],
    [["ON_SITE"], "onsite"],
    [["HYBRID", "REMOTE"], "partial"],
  ])("maps remote %j", (workPreferences, remote) => {
    expect(
      parseCollectiveProject({
        ...project,
        workPreferences: workPreferences as string[],
      }).remote,
    ).toBe(remote);
  });
  it("normalizes skills, HTML, date and location", () => {
    const offer = parseCollectiveProject({
      ...project,
      projectTypes: ["NEXT_JS", "NODE_JS", "C_SHARP", "DOT_NET"],
      description: "<p>React</p><p>Node &amp; Python</p><script>bad</script>",
      publishedAt: "invalid",
      location: { fullNameEnglish: "London" },
    });
    expect(offer.skills).toEqual(["Next.js", "Node.js", "C#", ".NET"]);
    expect(offer.description).toBe("React Node & Python");
    expect(offer.publishedAt).toBeNull();
    expect(offer.location).toBe("London");
    expect(offer.url).toBe("https://www.collective.work/jobs/fr/react-node");
  });
  it("applies existing rate and Java exclusions", () => {
    expect(
      matchOffer(
        parseCollectiveProject({
          ...project,
          budgetBrief: "400-500",
          projectTypes: ["JAVASCRIPT"],
        }),
        filters,
      ),
    ).toBe(true);
    expect(
      matchOffer(
        parseCollectiveProject({ ...project, budgetBrief: "400-440" }),
        filters,
      ),
    ).toBe(false);
    expect(
      matchOffer(
        parseCollectiveProject({ ...project, projectTypes: ["JAVA"] }),
        filters,
      ),
    ).toBe(false);
    expect(matchOffer(parseCollectiveProject(project), filters)).toBe(true);
  });
});

describe("Collective provider", () => {
  it("paginates, deduplicates queries, requests freelance/latest without rate/location restrictions", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValueOnce(response([project]))
      .mockResolvedValueOnce(response([{ ...project, id: "two" }]))
      .mockResolvedValueOnce(response([project]))
      .mockResolvedValueOnce(response([]));
    const provider = new CollectiveProvider({
      baseUrl: "https://example.test/graphql",
      postJson,
    });
    expect(
      await provider.search({ ...filters, queries: ["react", "node"] }),
    ).toHaveLength(2);
    expect(
      postJson.mock.calls.map((call) => call[1].variables.data.from),
    ).toEqual([0, 1, 0, 1]);
    expect(postJson.mock.calls[0]?.[1].variables.data).toMatchObject({
      contractType: "Freelance",
      sort: "Latest",
      dailyRates: { from: 0 },
      locations: [],
      hasDailyRate: false,
    });
  });
  it("stops at total and skips expired offers", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValue(
        response([{ ...project, expirationDate: "2020-01-01" }], 1),
      );
    expect(
      await new CollectiveProvider({
        baseUrl: "https://example.test",
        postJson,
        now: () => Date.parse("2026-01-01"),
      }).search(filters),
    ).toEqual([]);
    expect(postJson).toHaveBeenCalledTimes(1);
  });
  it.each([
    { errors: [{ message: "BAD_USER_INPUT" }] },
    { data: null },
    response([{ ...project, id: "" }]),
  ])("rejects API errors and malformed data", async (body) => {
    await expect(
      new CollectiveProvider({
        baseUrl: "https://example.test",
        postJson: async () => body,
      }).search(filters),
    ).rejects.toThrow(/Collective/);
  });
});
