import type { load } from "cheerio";

export type FreeWorkCardData = {
  publishedAt: string | undefined;
  remote: string | null | undefined;
  dailyRate: string | null | undefined;
  contracts: string[];
  skills: string[];
};

// Nuxt serializes values into a table: object properties and array entries are
// indices into that table. Read only the card fields we need, without evaluating
// scripts or recursively hydrating unrelated page state.
export function readFreeWorkPageData(
  $: ReturnType<typeof load>,
  baseUrl: string,
): Map<string, FreeWorkCardData> {
  const cards = new Map<string, FreeWorkCardData>();
  let values: unknown;

  try {
    values = JSON.parse($("script#__NUXT_DATA__").text());
  } catch {
    return cards;
  }

  if (!Array.isArray(values)) {
    return cards;
  }

  const table: unknown[] = values;
  const dereference = (index: unknown): unknown =>
    typeof index === "number" && Number.isInteger(index) && index >= 0
      ? table[index]
      : undefined;
  const strings = (index: unknown): string[] => {
    const refs = dereference(index);
    return Array.isArray(refs)
      ? refs
          .map(dereference)
          .filter((value): value is string => typeof value === "string")
      : [];
  };

  for (const record of table) {
    if (
      !isRecord(record) ||
      !("dailyRate" in record) ||
      !("publishedAt" in record)
    ) {
      continue;
    }

    const path = dereference(record.to);
    if (typeof path !== "string") {
      continue;
    }

    let url: URL;
    try {
      url = new URL(path, baseUrl);
    } catch {
      continue;
    }
    if (
      url.origin !== new URL(baseUrl).origin ||
      !url.pathname.startsWith("/fr/tech-it/job-mission/")
    ) {
      continue;
    }

    const skillRefs = dereference(record.skills);
    const skills = Array.isArray(skillRefs)
      ? skillRefs.flatMap((ref) => {
          const skill = dereference(ref);
          const name = isRecord(skill) ? dereference(skill.name) : undefined;
          return typeof name === "string" ? [name] : [];
        })
      : [];
    const publishedAt = dereference(record.publishedAt);
    const previous = cards.get(url.pathname);
    const remote = nullableString(dereference(record.remoteMode));

    cards.set(url.pathname, {
      publishedAt: typeof publishedAt === "string" ? publishedAt : undefined,
      remote: remote === undefined ? previous?.remote : remote,
      dailyRate: nullableString(dereference(record.dailyRate)),
      contracts: strings(record.contracts),
      skills: skills.length > 0 ? skills : (previous?.skills ?? []),
    });
  }

  return cards;
}

function nullableString(value: unknown): string | null | undefined {
  return typeof value === "string" || value === null ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
