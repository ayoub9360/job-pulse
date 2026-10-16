import type {
  JobOffer,
  KeywordExclusion,
  ProviderSearchFilters,
} from "../shared/types.js";

export function matchOffer(
  offer: JobOffer,
  filters: ProviderSearchFilters,
): boolean {
  const searchableText = normalize(
    [
      offer.title,
      offer.company,
      offer.location,
      offer.description,
      ...offer.skills,
      ...offer.contractTypes,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!matchesQuery(searchableText, filters.queries)) {
    return false;
  }

  // Stack requirements must occur in the offer, not in an employer/location
  // such as "Next Consulting". Every group is required; any term within it fits.
  const stackText = normalize(
    [
      offer.title,
      ...(filters.requiredKeywordScope === "title-skills"
        ? []
        : [offer.description]),
      ...offer.skills,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (
    !(filters.requiredKeywordGroups ?? []).every((group) =>
      group.some((keyword) =>
        matchesKeyword(stackText, { keyword, match: "whole-word" }),
      ),
    )
  ) {
    return false;
  }

  const titleKeywords = filters.requiredTitleKeywords ?? [];
  if (
    titleKeywords.length > 0 &&
    !titleKeywords.some((keyword) =>
      matchesKeyword(normalize(offer.title), { keyword, match: "whole-word" }),
    )
  ) {
    return false;
  }

  if (
    (filters.excludedTitleKeywords ?? []).some((keyword) =>
      matchesKeyword(normalize(offer.title), { keyword, match: "whole-word" }),
    )
  )
    return false;

  if (!matchesContracts(offer, filters.contracts)) {
    return false;
  }

  if (!matchesDailyRate(offer, filters.minDailyRate)) {
    return false;
  }

  if (!matchesRemote(offer, filters.remote)) {
    return false;
  }

  if (!matchesLocation(offer, filters.locations)) {
    return false;
  }

  return !filters.excludedKeywords.some((exclusion) =>
    matchesKeyword(searchableText, exclusion),
  );
}

function matchesKeyword(text: string, exclusion: KeywordExclusion): boolean {
  const keyword = normalize(
    typeof exclusion === "string" ? exclusion : exclusion.keyword,
  );
  if (typeof exclusion === "string" || exclusion.match === "substring") {
    return text.includes(keyword);
  }

  // Unicode boundaries keep JavaScript, Java17 and Java_foo distinct from Java.
  // Escape the literal keyword so terms such as C++ or .NET are not regexes.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])`,
    "u",
  ).test(text);
}

function matchesQuery(searchableText: string, queries: string[]): boolean {
  return (
    queries.length === 0 ||
    queries.some((query) => searchableText.includes(normalize(query)))
  );
}

function matchesContracts(offer: JobOffer, contracts: string[]): boolean {
  if (contracts.length === 0) {
    return true;
  }

  const offerContracts = offer.contractTypes.map(normalize);

  return contracts.some((contract) =>
    offerContracts.includes(normalize(contract)),
  );
}

function matchesDailyRate(
  offer: JobOffer,
  minDailyRate: number | null,
): boolean {
  if (minDailyRate === null) {
    return true;
  }

  const bestKnownRate = offer.dailyRate.max ?? offer.dailyRate.min;

  return bestKnownRate === null || bestKnownRate >= minDailyRate;
}

function matchesRemote(
  offer: JobOffer,
  remoteModes: ProviderSearchFilters["remote"],
): boolean {
  return remoteModes.length === 0 || remoteModes.includes(offer.remote);
}

function matchesLocation(offer: JobOffer, locations: string[]): boolean {
  const localLocations = locations.filter(
    (location) => !isProviderLocationCode(location),
  );

  if (localLocations.length === 0) {
    return true;
  }

  const offerLocation = normalize(offer.location ?? "");

  return localLocations.some((location) => {
    const normalizedLocation = normalize(location);

    return (
      offerLocation.includes(normalizedLocation) ||
      (normalizedLocation === "remote" && offer.remote === "full")
    );
  });
}

function isProviderLocationCode(location: string): boolean {
  return location.includes("~~~");
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
