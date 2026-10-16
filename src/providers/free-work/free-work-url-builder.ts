import type { ProviderSearchFilters } from "../../shared/types.js";

type BuildFreeWorkSearchUrlsInput = {
  baseUrl: string;
  filters: ProviderSearchFilters;
};

export function buildFreeWorkSearchUrls({
  baseUrl,
  filters,
}: BuildFreeWorkSearchUrlsInput): URL[] {
  return filters.queries.flatMap((query) =>
    Array.from({ length: filters.maxPages }, (_, index) => {
      const page = index + 1;
      const url = new URL(baseUrl);

      url.searchParams.set("query", query);
      url.searchParams.set("sort", "date");
      appendValues(url, "contracts", filters.contracts.map(toFreeWorkContract));
      appendValues(url, "locations", filters.locations);
      // Free-Work has no "unknown" search value. Keep the upstream search
      // broad in that case so the local OR filter can retain unknown offers.
      if (!filters.remote.includes("unknown")) {
        appendValues(url, "remote", filters.remote.map(toFreeWorkRemote));
      }

      if (filters.minDailyRate !== null) {
        url.searchParams.set("min_daily_rate", String(filters.minDailyRate));
      }

      if (page > 1) {
        url.searchParams.set("page", String(page));
      }

      return url;
    }),
  );
}

function appendValues(
  url: URL,
  key: string,
  values: Array<string | null>,
): void {
  for (const value of values) {
    if (value !== null) {
      url.searchParams.append(key, value);
    }
  }
}

function toFreeWorkContract(contract: string): string {
  if (contract.toLowerCase() === "freelance") {
    return "contractor";
  }
  if (contract.toLowerCase() === "cdi") {
    return "permanent";
  }

  return contract;
}

function toFreeWorkRemote(remote: string): string | null {
  switch (remote) {
    case "full":
    case "partial":
      return remote;
    case "onsite":
      return "none";
    case "unknown":
      return null;
    default:
      return remote;
  }
}
