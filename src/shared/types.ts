export type ProviderId = "free-work" | "pylote" | "collective";

export type RemoteMode = "full" | "partial" | "onsite" | "unknown";

export type DailyRate = {
  min: number | null;
  max: number | null;
};

export type JobOffer = {
  provider: ProviderId;
  providerOfferId: string;
  title: string;
  company: string | null;
  url: string;
  publishedAt: Date | null;
  contractTypes: string[];
  dailyRate: DailyRate;
  location: string | null;
  remote: RemoteMode;
  skills: string[];
  description: string | null;
};

export type KeywordExclusion =
  | string
  | { keyword: string; match: "substring" | "whole-word" };

export type ProviderSearchFilters = {
  queries: string[];
  requiredKeywordGroups?: string[][];
  requiredKeywordScope?: "offer" | "title-skills";
  requiredTitleKeywords?: string[];
  excludedTitleKeywords?: string[] | undefined;
  contracts: string[];
  minDailyRate: number | null;
  remote: RemoteMode[];
  locations: string[];
  excludedKeywords: KeywordExclusion[];
  maxPages: number;
};
