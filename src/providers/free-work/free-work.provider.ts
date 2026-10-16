import {
  type AppLogger,
  logger as defaultLogger,
} from "../../shared/logger.js";
import type { JobOffer, ProviderSearchFilters } from "../../shared/types.js";
import type { JobProvider } from "../provider.js";
import { parseFreeWorkSearch } from "./free-work.parser.js";
import { buildFreeWorkSearchUrls } from "./free-work-url-builder.js";

export type FetchText = (url: URL) => Promise<string>;

type FreeWorkProviderInput = {
  baseUrl: string;
  fetchText: FetchText;
  logger?: AppLogger;
};

export class FreeWorkProvider implements JobProvider {
  readonly id = "free-work";

  private readonly baseUrl: string;
  private readonly fetchText: FetchText;
  private readonly logger: AppLogger;

  constructor({
    baseUrl,
    fetchText,
    logger = defaultLogger,
  }: FreeWorkProviderInput) {
    this.baseUrl = baseUrl;
    this.fetchText = fetchText;
    this.logger = logger;
  }

  async search(filters: ProviderSearchFilters): Promise<JobOffer[]> {
    const urls = buildFreeWorkSearchUrls({
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
      "free-work search started",
    );

    for (const [urlIndex, url] of urls.entries()) {
      this.logger.debug(
        {
          providerId: this.id,
          url: url.origin,
          urlIndex: urlIndex + 1,
          urlTotal: urls.length,
        },
        "free-work page fetch started",
      );

      const html = await this.fetchText(url);
      const offers = parseFreeWorkSearch(html, this.baseUrl);
      rawOfferCount += offers.length;

      this.logger.debug(
        {
          offerCount: offers.length,
          providerId: this.id,
          url: url.origin,
          urlIndex: urlIndex + 1,
          urlTotal: urls.length,
        },
        "free-work page parsed",
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
      "free-work search completed",
    );

    return Array.from(offersById.values());
  }
}
