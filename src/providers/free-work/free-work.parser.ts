import { load } from "cheerio";
import type { JobOffer, RemoteMode } from "../../shared/types.js";
import {
  type FreeWorkCardData,
  readFreeWorkPageData,
} from "./free-work-page-data.js";

const CONTRACT_LABELS = new Set([
  "freelance",
  "cdi",
  "cdd",
  "alternance",
  "stage",
]);
const CARD_CONTENT_SELECTOR = "div.px-4.pb-4.flex.flex-col.h-full";

export function parseFreeWorkSearch(html: string, baseUrl: string): JobOffer[] {
  const $ = load(html);
  const pageData = readFreeWorkPageData($, baseUrl);
  const monthFirst = $("time")
    .toArray()
    .some((element) => {
      const match = cleanText($(element).text()).match(
        /^\d{1,2}\/(\d{1,2})\/\d{4}$/,
      );
      return match !== null && Number(match[1]) > 12;
    });
  const cardsByPath = new Map<
    string,
    { card: ReturnType<typeof $>; href: string }
  >();

  $('a[href*="/fr/tech-it/job-mission/"]').each((_, element) => {
    const link = $(element);
    const href = link.attr("href");

    if (!href) {
      return;
    }

    const card = findOfferContent(link);

    if (!card) {
      return;
    }

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (url.origin !== new URL(baseUrl).origin) {
      return;
    }
    const currentEntry = cardsByPath.get(url.pathname);

    if (
      !currentEntry ||
      cleanText(card.text()).length > cleanText(currentEntry.card.text()).length
    ) {
      cardsByPath.set(url.pathname, { card, href });
    }
  });

  return Array.from(cardsByPath.entries())
    .map(([providerOfferId, { card, href }]) =>
      parseOfferCard(
        $,
        card,
        href,
        providerOfferId,
        baseUrl,
        pageData.get(providerOfferId),
        monthFirst,
      ),
    )
    .filter((offer): offer is JobOffer => offer !== null);
}

function findOfferContent(
  link: ReturnType<ReturnType<typeof load>>,
): ReturnType<ReturnType<typeof load>> | null {
  // Keep the enclosing link, including its header/contract badges. Selecting
  // only the content div loses these badges on current Free-Work cards.
  if (link.find("h3").length === 1) {
    return link;
  }

  const closestContent = link.closest(CARD_CONTENT_SELECTOR);

  if (closestContent.length > 0 && closestContent.find("h3").length > 0) {
    return closestContent;
  }

  return null;
}

function parseOfferCard(
  $: ReturnType<typeof load>,
  card: ReturnType<ReturnType<typeof load>>,
  href: string,
  providerOfferId: string,
  baseUrl: string,
  pageData: FreeWorkCardData | undefined,
  monthFirst: boolean,
): JobOffer | null {
  const url = new URL(href, baseUrl);
  const title = stripTitlePrefix(
    cleanText(
      card.find("h3 .fw-text-highlight").first().text() ||
        card.find("h3 .line-clamp-2").first().text() ||
        card.find("h3").first().text(),
    ),
  );

  if (!title) {
    return null;
  }

  const company =
    cleanText(
      card.find(".text-base.font-medium.truncate.w-full").first().text(),
    ) || null;
  const time = card.find("time").first();
  const publishedAt =
    parseDate(pageData?.publishedAt ?? "", monthFirst) ??
    parseDate(time.attr("datetime") ?? "", monthFirst) ??
    parseDate(cleanText(time.text()), monthFirst);
  const contractTypes = unique([
    ...(pageData?.contracts ?? []).map(normalizeContract).filter(Boolean),
    ...parseContractTypes($, card),
  ]);
  const skills = unique([...(pageData?.skills ?? []), ...parseSkills($, card)]);
  const details = card.clone();
  details.find(".line-clamp-3, header, h3, time, .bg-brand-75").remove();
  const detailTexts = details
    .find("div, span")
    .map((_, element) => cleanText($(element).text()))
    .get();
  const dailyRate =
    pageData?.dailyRate !== undefined
      ? parseDailyRate(pageData.dailyRate ?? "")
      : (detailTexts.map(parseDailyRate).find((rate) => rate.min !== null) ?? {
          min: null,
          max: null,
        });
  const remote =
    pageData?.remote === null
      ? "unknown"
      : parseRemoteMode(pageData?.remote ?? "") !== "unknown"
        ? parseRemoteMode(pageData?.remote ?? "")
        : parseRemoteMode(detailTexts.join(" "));

  return {
    provider: "free-work",
    providerOfferId,
    title,
    company,
    url: url.toString(),
    publishedAt,
    contractTypes,
    dailyRate,
    location: parseLocation($, card),
    remote,
    skills,
    description: cleanText(card.find(".line-clamp-3").first().text()) || null,
  };
}

function parseContractTypes(
  $: ReturnType<typeof load>,
  card: ReturnType<ReturnType<typeof load>>,
): string[] {
  const exactLabels = card
    .find("header .tag")
    .map((_, element) => cleanText($(element).text()).toLowerCase())
    .get()
    .filter((label) => CONTRACT_LABELS.has(label));
  const sourceText = normalizeSpaces(
    [
      card.prev("a").text(),
      card.find("h3").first().text(),
      ...card
        .find("h3 span")
        .map((_, element) => $(element).text())
        .get(),
    ].join(" "),
  );
  const inferredLabels = Array.from(CONTRACT_LABELS).filter((label) =>
    sourceText.includes(` ${label} `),
  );

  return unique([...exactLabels, ...inferredLabels]);
}

function parseSkills(
  $: ReturnType<typeof load>,
  card: ReturnType<ReturnType<typeof load>>,
): string[] {
  return unique(
    card
      .find(".bg-brand-75 .fw-text-highlight, .bg-brand-75")
      .map((_, element) => cleanText($(element).text()))
      .get()
      .filter(Boolean),
  );
}

function parseLocation(
  $: ReturnType<typeof load>,
  card: ReturnType<ReturnType<typeof load>>,
): string | null {
  const locations = card
    .find("[title]")
    .map((_, element) => cleanText($(element).attr("title") ?? ""))
    .get()
    .filter(Boolean);

  return locations.at(-1) ?? null;
}

function parseDate(value: string, monthFirst: boolean): Date | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const localized = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!iso && !localized) return null;
  const year = Number(iso?.[1] ?? localized?.[3]);
  const month = Number(iso?.[2] ?? localized?.[monthFirst ? 1 : 2]);
  const day = Number(iso?.[3] ?? localized?.[monthFirst ? 2 : 1]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  )
    return null;
  const date = iso ? new Date(value) : calendarDate;
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDailyRate(value: string): {
  min: number | null;
  max: number | null;
} {
  // Match a rate field, never a salary or an amount buried in the description.
  const match = cleanText(value).match(
    /^(?:TJM\s*:?\s*)?(\d+(?: \d{3})*(?:[,.]\d{1,2})?)\s*(?:€?\s*[-–—à]\s*(\d+(?: \d{3})*(?:[,.]\d{1,2})?)\s*)?€(?:\s*(?:\/\s*j(?:our)?|par jour))?$/i,
  );
  if (match) {
    const min = Number(match[1]?.replace(/ /g, "").replace(",", "."));
    const max = match[2]
      ? Number(match[2].replace(/ /g, "").replace(",", "."))
      : min;
    if (min > 0 && min <= max && max < 10_000) return { min, max };
  }

  return { min: null, max: null };
}

function parseRemoteMode(value: string): RemoteMode {
  const normalizedValue = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (
    ["none", "onsite"].includes(normalizedValue) ||
    /(?:pas de teletravail|sans teletravail|teletravail\s*:\s*non|presentiel|sur site)/.test(
      normalizedValue,
    )
  ) {
    return "onsite";
  }

  if (
    normalizedValue === "full" ||
    /(?:teletravail\s*100\s*%|100\s*%\s*teletravail|full remote|teletravail complet)/.test(
      normalizedValue,
    )
  ) {
    return "full";
  }

  if (
    normalizedValue === "partial" ||
    /(?:teletravail partiel|hybride)/.test(normalizedValue)
  ) {
    return "partial";
  }

  return "unknown";
}

function normalizeContract(value: string): string {
  const labels: Record<string, string> = {
    contractor: "freelance",
    permanent: "cdi",
    fixed_term: "cdd",
    apprenticeship: "alternance",
    internship: "stage",
  };
  const normalized = value.toLowerCase();
  return (
    labels[normalized] ?? (CONTRACT_LABELS.has(normalized) ? normalized : "")
  );
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSpaces(value: string): string {
  return ` ${cleanText(value).toLowerCase()} `;
}

function stripTitlePrefix(value: string): string {
  return value.replace(/^(offre d'emploi|mission freelance)\s+/i, "").trim();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
