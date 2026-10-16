import { describe, expect, it } from "vitest";
import { PyloteProvider } from "../../src/providers/pylote/pylote.provider.js";

describe("PyloteProvider", () => {
  it("searches Pylote jobs and normalizes compact missions", async () => {
    const fetchedUrls: string[] = [];
    const provider = new PyloteProvider({
      baseUrl: "https://api-prod.pylote.io",
      fetchText: async (url) => {
        fetchedUrls.push(url.toString());

        return JSON.stringify({
          results: [
            {
              id: "mission-123",
              title: "Mission React Senior",
              company: "ACME Conseil",
              url: "https://pylote.test/jobs/mission-123",
              tjm: { min: 500, max: 650 },
              city: "Paris",
              remote: true,
              skills: ["React", "TypeScript"],
              publishedAt: "2026-07-17T08:00:00.000Z",
            },
          ],
        });
      },
    });

    const offers = await provider.search({
      queries: ["react"],
      contracts: ["freelance"],
      minDailyRate: 450,
      remote: ["full"],
      locations: ["Paris"],
      excludedKeywords: [],
      maxPages: 2,
    });

    const url = new URL(fetchedUrls[0] ?? "");

    expect(fetchedUrls).toHaveLength(1);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api-prod.pylote.io/v1/me/jobs/search",
    );
    expect(url.searchParams.get("query")).toBe("react");
    expect(url.searchParams.get("tjmMin")).toBe("450");
    expect(url.searchParams.get("tjmKnownOnly")).toBe("false");
    expect(url.searchParams.get("remote")).toBe("true");
    expect(url.searchParams.get("city")).toBe("Paris");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(offers).toEqual([
      {
        provider: "pylote",
        providerOfferId: "mission-123",
        title: "Mission React Senior",
        company: "ACME Conseil",
        url: "https://pylote.test/jobs/mission-123",
        publishedAt: new Date("2026-07-17T08:00:00.000Z"),
        contractTypes: ["freelance"],
        dailyRate: { min: 500, max: 650 },
        location: "Paris",
        remote: "full",
        skills: ["React", "TypeScript"],
        description: null,
      },
    ]);
  });
});
