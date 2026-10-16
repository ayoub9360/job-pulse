import {
  type AppLogger,
  logger as defaultLogger,
} from "../../shared/logger.js";
import type {
  DailyRate,
  JobOffer,
  ProviderSearchFilters,
} from "../../shared/types.js";
import type { JobProvider } from "../provider.js";

export type FetchText = (url: URL) => Promise<string>;

type PyloteProviderInput = {
  baseUrl: string;
  fetchText: FetchText;
  logger?: AppLogger;
};

type PyloteSearchResponse = unknown;

const RESULTS_PER_PAGE = 50;

export class PyloteProvider implements JobProvider {
  readonly id = "pylote";

  private readonly baseUrl: string;
  private readonly fetchText: FetchText;
  private readonly logger: AppLogger;

  constructor({
    baseUrl,
    fetchText,
    logger = defaultLogger,
  }: PyloteProviderInput) {
    this.baseUrl = baseUrl;
    this.fetchText = fetchText;
    this.logger = logger;
  }

  async search(filters: ProviderSearchFilters): Promise<JobOffer[]> {
    const urls = buildPyloteSearchUrls({
      baseUrl: this.baseUrl,
      filters,
    });
    const offersById = new Map<string, JobOffer>();
    let rawOfferCount = 0;

    this.logger.info(
      {
        maxPages: filters.maxPages,
        providerId: this.id,
        queryCount: filters.queries.length,
        urlCount: urls.length,
      },
      "pylote search started",
    );

    for (const [urlIndex, url] of urls.entries()) {
      this.logger.debug(
        {
          providerId: this.id,
          url: url.origin,
          urlIndex: urlIndex + 1,
          urlTotal: urls.length,
        },
        "pylote page fetch started",
      );

      const response = parsePyloteSearchResponse(await this.fetchText(url));
      const offers = extractPyloteItems(response)
        .map((item) => normalizePyloteOffer(item))
        .filter((offer): offer is JobOffer => offer !== null);
      rawOfferCount += offers.length;

      this.logger.debug(
        {
          offerCount: offers.length,
          providerId: this.id,
          url: url.origin,
          urlIndex: urlIndex + 1,
          urlTotal: urls.length,
        },
        "pylote page parsed",
      );

      for (const offer of offers) {
        offersById.set(offer.providerOfferId, offer);
      }
    }

    this.logger.info(
      {
        duplicateCount: rawOfferCount - offersById.size,
        providerId: this.id,
        rawOfferCount,
        uniqueOfferCount: offersById.size,
      },
      "pylote search completed",
    );

    return Array.from(offersById.values());
  }
}

function buildPyloteSearchUrls({
  baseUrl,
  filters,
}: {
  baseUrl: string;
  filters: ProviderSearchFilters;
}): URL[] {
  const queries = filters.queries.length > 0 ? filters.queries : [""];

  return queries.map((query) => {
    const url = new URL("/v1/me/jobs/search", baseUrl);

    url.searchParams.set("query", query);
    url.searchParams.set("tjmMin", String(filters.minDailyRate ?? 0));
    url.searchParams.set("tjmKnownOnly", "false");
    url.searchParams.set("remote", String(shouldRequestRemoteOnly(filters)));
    url.searchParams.set("city", getCityFilter(filters.locations));
    url.searchParams.set(
      "limit",
      String(Math.max(1, filters.maxPages) * RESULTS_PER_PAGE),
    );

    return url;
  });
}

function shouldRequestRemoteOnly(filters: ProviderSearchFilters): boolean {
  return (
    filters.remote.length > 0 && filters.remote.every((mode) => mode === "full")
  );
}

function getCityFilter(locations: string[]): string {
  return locations.find((location) => !isProviderLocationCode(location)) ?? "";
}

function isProviderLocationCode(location: string): boolean {
  return location.includes("~~~");
}

function parsePyloteSearchResponse(rawResponse: string): PyloteSearchResponse {
  return JSON.parse(rawResponse) as PyloteSearchResponse;
}

function extractPyloteItems(response: PyloteSearchResponse): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (!isRecord(response)) {
    return [];
  }

  const results = response.results;

  return Array.isArray(results) ? results : [];
}

function normalizePyloteOffer(item: unknown): JobOffer | null {
  if (!isRecord(item)) {
    return null;
  }

  const id = getString(item, ["id", "jobId", "_id"]);
  const title = getString(item, ["title", "name"]);
  const url = getString(item, ["url", "link", "applyUrl"]);

  if (!id || !title || !url) {
    return null;
  }

  return {
    provider: "pylote",
    providerOfferId: id,
    title,
    company: getString(item, ["company", "client", "source", "platform"]),
    url,
    publishedAt: parseDate(
      getString(item, ["publishedAt", "postedAt", "createdAt", "date"]),
    ),
    contractTypes: parseContractTypes(item),
    dailyRate: parseDailyRate(
      item.tjm ?? item.dailyRate ?? item.rate ?? item.tjmMin ?? null,
    ),
    location: getString(item, ["city", "location"]),
    remote: parseRemote(item.remote ?? item.remoteWork),
    skills: parseStringArray(item.skills ?? item.tags ?? item.technologies),
    description: getString(item, ["description", "summary"]),
  };
}

function parseContractTypes(item: Record<string, unknown>): string[] {
  const contractTypes = parseStringArray(
    item.contractTypes ?? item.contracts ?? item.contractType,
  );

  return contractTypes.length > 0 ? contractTypes : ["freelance"];
}

function parseDailyRate(value: unknown): DailyRate {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { min: value, max: value };
  }

  if (typeof value === "string") {
    const numbers = value.match(/\d{2,4}/g)?.map(Number) ?? [];

    return {
      min: numbers[0] ?? null,
      max: numbers[1] ?? numbers[0] ?? null,
    };
  }

  if (isRecord(value)) {
    const min = getNumber(value, ["min", "minimum", "from"]);
    const max = getNumber(value, ["max", "maximum", "to"]);

    return { min, max: max ?? min };
  }

  return { min: null, max: null };
}

function parseRemote(value: unknown): JobOffer["remote"] {
  if (value === true) {
    return "full";
  }

  if (value === false) {
    return "onsite";
  }

  if (typeof value !== "string") {
    return "unknown";
  }

  const normalizedValue = normalize(value);

  if (
    normalizedValue.includes("partial") ||
    normalizedValue.includes("hybrid") ||
    normalizedValue.includes("hybride") ||
    normalizedValue.includes("partiel")
  ) {
    return "partial";
  }

  if (
    normalizedValue.includes("100") ||
    normalizedValue.includes("full") ||
    normalizedValue.includes("remote") ||
    normalizedValue.includes("teletravail")
  ) {
    return "full";
  }

  if (
    normalizedValue.includes("none") ||
    normalizedValue.includes("onsite") ||
    normalizedValue.includes("site") ||
    normalizedValue.includes("presentiel")
  ) {
    return "onsite";
  }

  return "unknown";
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (isRecord(item)) {
          return getString(item, ["name", "label", "title"]);
        }

        return null;
      })
      .filter((item): item is string => item !== null && item.length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function getString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsedValue = Number(value);

      if (Number.isFinite(parsedValue)) {
        return parsedValue;
      }
    }
  }

  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
