import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFreeWorkSearch } from "../../src/providers/free-work/free-work.parser.js";
import { FreeWorkProvider } from "../../src/providers/free-work/free-work.provider.js";
import { buildFreeWorkSearchUrls } from "../../src/providers/free-work/free-work-url-builder.js";

describe("parseFreeWorkSearch", () => {
  it("normalizes Free-Work search cards into job offers", async () => {
    const html = await readFile(
      join(process.cwd(), "tests/fixtures/free-work-search.html"),
      "utf8",
    );

    const offers = parseFreeWorkSearch(html, "https://www.free-work.com");

    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      provider: "free-work",
      providerOfferId:
        "/fr/tech-it/job-mission/developpeur-front-end-javascript-node-react-angular-vue/developpeur-react-senior-42",
      title: "Developpeur React Senior",
      company: "ACME Conseil",
      url: "https://www.free-work.com/fr/tech-it/job-mission/developpeur-front-end-javascript-node-react-angular-vue/developpeur-react-senior-42",
      contractTypes: ["freelance", "cdi"],
      dailyRate: { min: 450, max: 600 },
      location: "Paris, France",
      remote: "partial",
      skills: ["React", "TypeScript"],
      description: "Mission longue sur une application front critique.",
    });
    expect(offers[0]?.publishedAt?.toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
    expect(offers[1]?.remote).toBe("full");
  });

  it("parses Free-Work cards after HTML normalization splits nested links", async () => {
    const html = await readFile(
      join(process.cwd(), "tests/fixtures/free-work-search-normalized.html"),
      "utf8",
    );

    const offers = parseFreeWorkSearch(html, "https://www.free-work.com");

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      providerOfferId:
        "/fr/tech-it/job-mission/developpeur-front-end-javascript-node-react-angular-vue/lead-tech-full-stack-net-9-react-h-f",
      title: "Lead Tech Full Stack .NET 9 / React (H/F)",
      company: "ADONYS",
      contractTypes: ["freelance", "cdi"],
      dailyRate: { min: 450, max: 550 },
      location: "Hauts-de-Seine, France",
      skills: [".NET", "React"],
      description: "Contexte industriel critique.",
    });
  });
});

describe("buildFreeWorkSearchUrls", () => {
  it("combines freelance/CDI, multiple locations and remote modes without filtering unknown remotely", () => {
    const [url] = buildFreeWorkSearchUrls({
      baseUrl: "https://www.free-work.com/fr/tech-it/jobs",
      filters: {
        queries: ["data engineer"],
        contracts: ["freelance", "cdi"],
        locations: ["fr~~~", "Paris"],
        remote: ["full", "unknown"],
        minDailyRate: null,
        excludedKeywords: [],
        maxPages: 1,
      },
    });
    expect(url?.searchParams.getAll("contracts")).toEqual([
      "contractor",
      "permanent",
    ]);
    expect(url?.searchParams.getAll("locations")).toEqual(["fr~~~", "Paris"]);
    expect(url?.searchParams.getAll("remote")).toEqual([]);
    expect(url?.searchParams.has("min_daily_rate")).toBe(false);
    expect(url?.searchParams.get("query")).toBe("data engineer");
  });

  it("builds one URL per query and page with Free-Work filters", () => {
    const urls = buildFreeWorkSearchUrls({
      baseUrl: "https://www.free-work.com/fr/tech-it/jobs",
      filters: {
        queries: ["react", "next.js"],
        contracts: ["freelance"],
        minDailyRate: 400,
        remote: ["partial", "full", "onsite"],
        locations: ["fr~~~"],
        excludedKeywords: [],
        maxPages: 2,
      },
    });

    expect(urls).toHaveLength(4);
    expect(urls[0]?.searchParams.get("query")).toBe("react");
    expect(urls[0]?.searchParams.get("contracts")).toBe("contractor");
    expect(urls[0]?.searchParams.get("locations")).toBe("fr~~~");
    expect(urls[0]?.searchParams.get("sort")).toBe("date");
    expect(urls[0]?.searchParams.getAll("remote")).toEqual([
      "partial",
      "full",
      "none",
    ]);
    expect(urls[0]?.searchParams.get("min_daily_rate")).toBe("400");
    expect(urls[0]?.searchParams.get("page")).toBeNull();
    expect(urls[1]?.searchParams.get("page")).toBe("2");
    expect(urls[2]?.searchParams.get("query")).toBe("next.js");
  });
});

describe("FreeWorkProvider", () => {
  it("searches configured Free-Work pages and returns deduplicated offers", async () => {
    const html = await readFile(
      join(process.cwd(), "tests/fixtures/free-work-search.html"),
      "utf8",
    );
    const fetchedUrls: string[] = [];
    const provider = new FreeWorkProvider({
      baseUrl: "https://www.free-work.com/fr/tech-it/jobs",
      fetchText: async (url) => {
        fetchedUrls.push(url.toString());
        return html;
      },
    });

    const offers = await provider.search({
      queries: ["react"],
      contracts: [],
      minDailyRate: null,
      remote: [],
      locations: [],
      excludedKeywords: [],
      maxPages: 2,
    });

    expect(fetchedUrls).toEqual([
      "https://www.free-work.com/fr/tech-it/jobs?query=react&sort=date",
      "https://www.free-work.com/fr/tech-it/jobs?query=react&sort=date&page=2",
    ]);
    expect(offers).toHaveLength(2);
    expect(offers.map((offer) => offer.providerOfferId)).toEqual([
      "/fr/tech-it/job-mission/developpeur-front-end-javascript-node-react-angular-vue/developpeur-react-senior-42",
      "/fr/tech-it/job-mission/lead-developer/tech-lead-nextjs-7",
    ]);
  });
});
