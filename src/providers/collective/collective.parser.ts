import { load } from "cheerio";
import { z } from "zod";
import type { DailyRate, JobOffer } from "../../shared/types.js";

const optionalText = z.string().nullish();
export const collectiveProjectSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: optionalText,
  sumUp: optionalText,
  budgetBrief: optionalText,
  workPreferences: z.array(z.string()).nullish(),
  contractTypes: z.array(z.string()).nullish(),
  projectTypes: z.array(z.string()).nullish(),
  projectTypeSuggestions: z.array(z.string()).nullish(),
  language: optionalText,
  publishedAt: optionalText,
  expirationDate: optionalText,
  minSalary: z.number().nullish(),
  maxSalary: z.number().nullish(),
  salaryCurrency: optionalText,
  salaryFrequency: optionalText,
  company: z.object({ name: optionalText }).nullish(),
  location: z
    .object({ fullNameFrench: optionalText, fullNameEnglish: optionalText })
    .nullish(),
});
export type CollectiveProject = z.infer<typeof collectiveProjectSchema>;

export function parseCollectiveProject(project: CollectiveProject): JobOffer {
  const preferences = project.workPreferences ?? [];
  return {
    provider: "collective",
    providerOfferId: project.id,
    title: project.name,
    company: project.company?.name ?? null,
    url: `https://www.collective.work/jobs/${encodeURIComponent(project.language || "fr")}/${encodeURIComponent(project.slug)}`,
    publishedAt: validDate(project.publishedAt),
    contractTypes: parseCollectiveContracts(project),
    dailyRate: parseCollectiveRate(project),
    location:
      project.location?.fullNameFrench ||
      project.location?.fullNameEnglish ||
      null,
    remote: preferences.includes("HYBRID")
      ? "partial"
      : preferences.includes("REMOTE")
        ? "full"
        : preferences.includes("ON_SITE")
          ? "onsite"
          : "unknown",
    skills: [
      ...new Set(
        [
          ...(project.projectTypes ?? []),
          ...(project.projectTypeSuggestions ?? []),
        ].map(normalizeSkill),
      ),
    ],
    description: plainText(project.description || project.sumUp),
  };
}

function normalizeSkill(value: string): string {
  const aliases: Record<string, string> = {
    C_SHARP: "C#",
    CSHARP: "C#",
    DOT_NET: ".NET",
    DOTNET: ".NET",
    NODE_JS: "Node.js",
    NODEJS: "Node.js",
    NEXT_JS: "Next.js",
    NEXTJS: "Next.js",
    NEST_JS: "Nest.js",
    NESTJS: "Nest.js",
    VUE_JS: "Vue.js",
    VUEJS: "Vue.js",
    NUXT_JS: "Nuxt.js",
    NUXTJS: "Nuxt.js",
    FAST_API: "FastAPI",
    REACT_JS: "React.js",
    EXPRESS_JS: "Express.js",
  };
  return aliases[value.toUpperCase()] ?? value.replaceAll("_", " ");
}

function plainText(value: string | null | undefined): string | null {
  if (!value) return null;
  const $ = load(value);
  $("script, style").remove();
  $("p,div,li,h1,h2,h3,h4,br").each((_index, element) => {
    $(element).append(" ");
  });
  return $.text().replace(/\s+/g, " ").trim() || null;
}

export function validDate(value: string | null | undefined): Date | null {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function parseCollectiveRate(project: CollectiveProject): DailyRate {
  const unknown = { min: null, max: null };
  const currency = project.salaryCurrency?.toUpperCase();
  if (currency && currency !== "EUR") return unknown;
  const frequency = project.salaryFrequency?.toUpperCase();
  if (frequency && !["DAILY", "PER_DAY"].includes(frequency)) return unknown;
  const amount = (value: number | null | undefined) =>
    value && value > 0 && value < 10000 ? value : null;
  if (frequency) {
    const min = amount(project.minSalary);
    const max = amount(project.maxSalary);
    if (min !== null || max !== null)
      return {
        min: min !== null && max !== null ? Math.min(min, max) : min,
        max: min !== null && max !== null ? Math.max(min, max) : max,
      };
  }
  if (!(project.contractTypes ?? []).includes("FREELANCE")) return unknown;
  const text = (plainText(project.budgetBrief) ?? "").toLowerCase();
  if (
    /\b(year|yearly|annual|annuel|an|month|monthly|mois|mensuel|hour|hourly|heure|week|semaine|usd|gbp|chf)\b|[$£]|\d\s*k\b/.test(
      text,
    )
  )
    return unknown;
  // Only a budget amount/range with an optional daily unit; never numbers in prose/durations.
  const match = text.match(
    /^(?:fourchette proposée par le client\s*:\s*)?(?:(à partir de|jusqu['’]à|from|up to)\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*(?:€|eur|e))?\s*(?:(?:-|–|—|à|to)\s*(\d+(?:[.,]\d{1,2})?))?\s*(?:€|eur|e)?\s*(?:ht)?\s*(?:(?:\/\s*|par\s+|per\s+)(?:jour|day)|de tjm|tjm)?\s*$/i,
  );
  if (!match) return unknown;
  const first = amount(Number(match[2]?.replace(",", ".")));
  const second = match[3] ? amount(Number(match[3].replace(",", "."))) : null;
  if (first === null || (match[3] && second === null)) return unknown;
  if (second !== null)
    return { min: Math.min(first, second), max: Math.max(first, second) };
  if (/^(jusqu|up to)/.test(match[1] ?? "")) return { min: null, max: first };
  if (match[1]) return { min: first, max: null };
  return { min: first, max: first };
}

// Aggregated ads sometimes say FULL_TIME while advertising a fixed-term contract.
// Match contract statements, not incidental mentions of staffing/previous internships.
function parseCollectiveContracts(project: CollectiveProject): string[] {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const title = normalize(project.name);
  const description = normalize(plainText(project.description) ?? "");
  if (/\b(stage|stagiaire|internship)\b/.test(title)) return ["internship"];
  if (/\b(alternance|alternant|alternante|apprentissage)\b/.test(title))
    return ["apprenticeship"];
  if (
    /\bcdd\b|\bfixed[ -]term\b/.test(title) ||
    /\b(?:en cdd|contrat\s*(?::|de travail\s*:)?\s*cdd|rythme de travail\s*:?[ ]*cdd)\b/.test(
      description,
    )
  )
    return ["cdd"];
  if (
    /\binterim\b/.test(title) ||
    /\b(?:conditions|type de contrat|contrat de travail)\s*:\s*interim\b/.test(
      description,
    )
  )
    return ["temporary"];
  return (project.contractTypes ?? []).map((value) =>
    value === "FULL_TIME" ? "cdi" : value.toLowerCase(),
  );
}
