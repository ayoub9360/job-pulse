import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { matchOffer } from "../../src/filters/match-offer.js";
import { parseFreeWorkSearch } from "../../src/providers/free-work/free-work.parser.js";
import type { ProviderSearchFilters } from "../../src/shared/types.js";

const baseUrl = "https://www.free-work.com";
const path = "/fr/tech-it/job-mission/developpeur/react";
const filters: ProviderSearchFilters = {
  queries: ["react"],
  contracts: ["freelance"],
  minDailyRate: 450,
  remote: [],
  locations: ["fr~~~"],
  excludedKeywords: [],
  maxPages: 1,
};

function card(details: string, description = "", href = path): string {
  // Deliberately no whitespace between spans, as in the server-rendered HTML.
  return `<a href="${href}"><header><span class="tag">Freelance</span></header><div class="px-4 pb-4 flex flex-col h-full"><h3><span>Mission freelance</span><span class="fw-text-highlight">Développeur React</span></h3>${details}<div class="line-clamp-3">${description}</div></div></a>`;
}

async function currentPage(): Promise<string> {
  return readFile(
    join(process.cwd(), "tests/fixtures/free-work-search-current.html"),
    "utf8",
  );
}

describe("current Free-Work pages", () => {
  it("reads sibling contract badges, exact dates, fixed rates and hidden remote metadata", async () => {
    const offers = parseFreeWorkSearch(await currentPage(), baseUrl);
    expect(offers).toHaveLength(5);
    expect(offers[0]).toMatchObject({
      title: "Dev. Fullstack",
      company: "Example Company",
      contractTypes: ["freelance"],
      dailyRate: { min: 600, max: 600 },
      remote: "partial",
      location: "Paris, France",
      skills: expect.arrayContaining(["React", "PostgreSQL"]),
    });
    expect(offers[0]?.publishedAt?.toISOString()).toBe(
      "2026-09-30T08:14:23.000Z",
    );
    expect(offers[1]?.contractTypes).toEqual(["freelance", "cdi"]);
    expect(offers[2]?.remote).toBe("full");
    // A promoted card may be absent from the Nuxt table: keep its HTML data.
    expect(offers[3]?.contractTypes).toContain("freelance");
    expect(offers[3]?.dailyRate).toEqual({ min: 370, max: 460 });
    expect(offers[3]?.publishedAt?.getUTCFullYear()).toBe(2026);
    expect(offers[4]?.dailyRate).toEqual({ min: 500, max: 600 });
  });

  it.each([
    ["react", "partial", 550, 2],
    ["react", "full", 450, 1],
    ["react", "full", 550, 0],
    ["data engineer", "partial", 450, 1],
  ] as const)(
    "filters %s / %s / %i euros",
    async (query, remote, rate, count) => {
      const offers = parseFreeWorkSearch(await currentPage(), baseUrl);
      expect(
        offers.filter((offer) =>
          matchOffer(offer, {
            ...filters,
            queries: [query],
            remote: [remote],
            minDailyRate: rate,
          }),
        ),
      ).toHaveLength(count);
    },
  );

  it("retains HTML-only parsing when structured data is absent or malformed", async () => {
    for (const payload of [
      "",
      "{bad json",
      "{}",
      "[null,42,{},[]]",
      '[{"to":0,"remoteMode":0}]',
    ]) {
      const $ = load(await currentPage());
      $("script").text(payload);
      const offers = parseFreeWorkSearch($.html(), baseUrl);
      expect(offers).toHaveLength(5);
      expect(offers[0]?.contractTypes).toEqual(["freelance"]);
      expect(offers[0]?.dailyRate).toEqual({ min: 600, max: 600 });
      expect(offers[0]?.publishedAt?.toISOString()).toBe(
        "2026-09-30T00:00:00.000Z",
      );
      expect(offers[1]?.contractTypes).toEqual(["freelance", "cdi"]);
    }
  });

  it("reads metadata even when remoteMode is missing, without another card variant erasing it", async () => {
    const $ = load(await currentPage());
    const table = JSON.parse($("script").text());
    const record = table.find(
      (value: Record<string, unknown> | null) =>
        value !== null && typeof value === "object" && "remoteMode" in value,
    );
    const alternate = { ...record };
    alternate.remoteMode = undefined;
    table.push(alternate);
    $("script").text(JSON.stringify(table));
    expect(parseFreeWorkSearch($.html(), baseUrl)[0]?.remote).toBe("partial");
    record.remoteMode = undefined;
    $("script").text(JSON.stringify(table));
    const [offer] = parseFreeWorkSearch($.html(), baseUrl);
    expect(offer?.remote).toBe("unknown");
    expect(offer?.publishedAt?.toISOString()).toBe("2026-09-30T08:14:23.000Z");
  });

  it("handles null and invalid metadata without inventing a rate, remote mode or date", async () => {
    const $ = load(await currentPage());
    const table = JSON.parse($("script").text());
    const record = table.find(
      (value: Record<string, unknown> | null) =>
        value !== null && typeof value === "object" && "remoteMode" in value,
    );
    record.remoteMode = table.push(null) - 1;
    record.dailyRate = table.push(null) - 1;
    record.publishedAt = table.push("2026-02-31T12:00:00Z") - 1;
    $("script").text(JSON.stringify(table));
    const [offer] = parseFreeWorkSearch($.html(), baseUrl);
    expect(offer?.remote).toBe("unknown");
    expect(offer?.dailyRate).toEqual({ min: null, max: null });
    expect(offer?.publishedAt?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
});

describe("HTML fallbacks and incomplete offers", () => {
  it.each([
    ["600 €", 600, 600],
    ["450-600 €", 450, 600],
    ["450 € – 650 €", 450, 650],
    ["450 à 650 €/jour", 450, 650],
    ["1\u202f200\u00a0€", 1200, 1200],
    ["550,50 € / j", 550.5, 550.5],
    ["TJM : 2 000 €", 2000, 2000],
    ["45k-70k €", null, null],
    ["45 000-70 000 €", null, null],
    ["3 000 € / mois", null, null],
    ["Selon profil", null, null],
    ["600-450 €", null, null],
    ["0 €", null, null],
  ])(
    "parses the rate %s without confusing salary and TJM",
    (value, min, max) => {
      const [offer] = parseFreeWorkSearch(
        card(`<div>${value}</div>`, "Budget matériel 900-1200 €"),
        baseUrl,
      );
      expect(offer?.dailyRate).toEqual({ min, max });
    },
  );

  it.each([
    ["Télétravail 100%", "full"],
    ["100 % télétravail", "full"],
    ["Full remote", "full"],
    ["Télétravail partiel", "partial"],
    ["Hybride", "partial"],
    ["Présentiel", "onsite"],
    ["Pas de télétravail", "onsite"],
    ["Télétravail : non", "onsite"],
    ["", "unknown"],
    ["À négocier", "unknown"],
  ])("parses remote label %s", (value, remote) => {
    const [offer] = parseFreeWorkSearch(
      card(`<div>${value}</div>`, "Une autre équipe est en full remote."),
      baseUrl,
    );
    expect(offer?.remote).toBe(remote);
  });

  it.each([
    ["06/07/2026", "2026-07-06T00:00:00.000Z"],
    ["09/30/2026", "2026-09-30T00:00:00.000Z"],
    ["30/09/2026", "2026-09-30T00:00:00.000Z"],
    ["29/02/2024", "2024-02-29T00:00:00.000Z"],
    ["31/02/2026", undefined],
    ["29/02/2025", undefined],
    ["13/32/2026", undefined],
    ["Hier", undefined],
  ])("validates publication date %s", (value, expected) => {
    const [offer] = parseFreeWorkSearch(card(`<time>${value}</time>`), baseUrl);
    expect(offer?.publishedAt?.toISOString()).toBe(expected);
  });

  it("prefers the datetime attribute and infers US format for other dates on a page", () => {
    const offers = parseFreeWorkSearch(
      card('<time datetime="2026-09-03T14:00:00+02:00">09/03/2026</time>') +
        card("<time>09/30/2026</time>", "", `${path}-2`) +
        card("<time>09/04/2026</time>", "", `${path}-3`),
      baseUrl,
    );
    expect(offers.map((offer) => offer.publishedAt?.toISOString())).toEqual([
      "2026-09-03T12:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
      "2026-09-04T00:00:00.000Z",
    ]);
  });

  it("infers the freelance heading with no whitespace and no header", () => {
    const html = card("").replace(/<header>.*?<\/header>/, "");
    expect(parseFreeWorkSearch(html, baseUrl)[0]?.contractTypes).toEqual([
      "freelance",
    ]);
  });

  it("deduplicates paths and ignores empty titles, unrelated links and external URLs", () => {
    const html = [
      card("<div>600 €</div>"),
      card("", "", `${baseUrl}${path}?tracking=1`),
      '<a href="/fr/tech-it/job-mission/empty"><h3></h3></a>',
      '<a href="/fr/tech-it/job-mission/navigation">Voir les offres</a>',
      card("", "", `https://elsewhere.test${path}`),
    ].join("");
    expect(parseFreeWorkSearch(html, baseUrl)).toHaveLength(1);
    expect(parseFreeWorkSearch("<main>Aucune offre</main>", baseUrl)).toEqual(
      [],
    );
  });
});
