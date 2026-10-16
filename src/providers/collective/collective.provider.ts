import { z } from "zod";
import type { PostJson } from "../../shared/curl-client.js";
import { logger } from "../../shared/logger.js";
import type { JobOffer, ProviderSearchFilters } from "../../shared/types.js";
import type { JobProvider } from "../provider.js";
import {
  collectiveProjectSchema,
  parseCollectiveProject,
  validDate,
} from "./collective.parser.js";

const query = `query PublicPages_SearchJobs($data: PublicPages_SearchJobsInputType!) {
  results: PublicPages_SearchJobs(data: $data) {
    projects {
      id slug name sumUp description budgetBrief workPreferences expirationDate
      contractTypes projectTypes projectTypeSuggestions language publishedAt
      minSalary maxSalary salaryCurrency salaryFrequency
      company { name } location { fullNameFrench fullNameEnglish }
    }
    pagination { from total }
  }
}`;
const responseSchema = z.object({
  data: z.object({
    results: z.object({
      projects: z.array(collectiveProjectSchema),
      pagination: z.object({ from: z.number(), total: z.number() }),
    }),
  }),
});

export class CollectiveProvider implements JobProvider {
  readonly id = "collective";
  constructor(
    private readonly options: {
      baseUrl: string;
      postJson: PostJson;
      now?: () => number;
    },
  ) {}

  async search(filters: ProviderSearchFilters): Promise<JobOffer[]> {
    const offers = new Map<string, JobOffer>();
    let rawOfferCount = 0;
    const now = this.options.now?.() ?? Date.now();
    logger.info(
      {
        providerId: this.id,
        queryCount: filters.queries.length,
        maxPages: filters.maxPages,
      },
      "collective search started",
    );
    for (const term of filters.queries) {
      let from = 0;
      for (let page = 0; page < filters.maxPages; page++) {
        const body = await this.options.postJson(this.options.baseUrl, {
          query,
          variables: {
            data: {
              query: term,
              from,
              sort: "Latest",
              dailyRates: { from: 0, to: null },
              salaryEur: { frequency: "Yearly", from: 0, to: null },
              companySize: { from: 0, to: null },
              industries: [],
              fundingStages: [],
              startup: false,
              investors: [],
              exclusive: false,
              locations: [],
              locationsV3: [],
              skills: [],
              workPreferences: [],
              hasDailyRate: false,
              companies: [],
              fromTopRecruiter: false,
              contractType:
                filters.contracts.length === 1 &&
                filters.contracts[0]?.toLowerCase() === "freelance"
                  ? "Freelance"
                  : "All",
              contractTypes: [],
              offerLanguages: [],
              recruiterOrganizationId: null,
              externalJobs: true,
              isDefaultSearch: false,
            },
          },
        });
        if (
          body &&
          typeof body === "object" &&
          "errors" in body &&
          Array.isArray(body.errors) &&
          body.errors.length
        ) {
          throw new Error("Collective GraphQL returned errors");
        }
        const parsed = responseSchema.safeParse(body);
        if (!parsed.success)
          throw new Error("Invalid Collective search response");
        const { projects, pagination } = parsed.data.data.results;
        rawOfferCount += projects.length;
        for (const project of projects) {
          const expires = validDate(project.expirationDate);
          if (expires && expires.getTime() <= now) continue;
          offers.set(project.id, parseCollectiveProject(project));
        }
        if (!projects.length) break;
        from += projects.length;
        if (from >= pagination.total) break;
      }
    }
    logger.info(
      { providerId: this.id, rawOfferCount, uniqueOfferCount: offers.size },
      "collective search completed",
    );
    return [...offers.values()];
  }
}
