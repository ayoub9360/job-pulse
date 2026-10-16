import type { Watcher } from "../check-new-offers.js";
import type { AppConfig } from "../config/config.schema.js";
import { DiscordNotifier } from "../notifications/discord.notifier.js";
import type { Notifier } from "../notifications/notifier.js";
import type { JobProvider } from "../providers/provider.js";
import { type AppLogger, logger as defaultLogger } from "../shared/logger.js";
import type { ProviderId, ProviderSearchFilters } from "../shared/types.js";

type CreateNotifierInput = {
  webhookUrl: string;
  mentionHere?: boolean;
  timeoutMs?: number;
};

type CreateWatchersInput = {
  config: AppConfig;
  env: NodeJS.ProcessEnv;
  providersById: Partial<Record<ProviderId, JobProvider>>;
  createNotifier?: (input: CreateNotifierInput) => Notifier;
  logger?: AppLogger;
};

export function createWatchers({
  config,
  env,
  providersById,
  createNotifier = (options) => new DiscordNotifier(options),
  logger = defaultLogger,
}: CreateWatchersInput): Watcher[] {
  const watchers: Watcher[] = [];

  for (const watcherConfig of config.watchers) {
    if (!watcherConfig.enabled) {
      logger.info(
        {
          watcherName: watcherConfig.name,
        },
        "watcher disabled",
      );
      continue;
    }

    const webhookUrl = env[watcherConfig.webhookEnv];

    if (!webhookUrl) {
      throw new Error(
        `Missing environment variable: ${watcherConfig.webhookEnv}`,
      );
    }

    for (const providerId of [watcherConfig.provider].flat()) {
      const provider = providersById[providerId];

      if (!provider) {
        throw new Error(`Missing provider: ${providerId}`);
      }

      const filters: ProviderSearchFilters = {
        queries: watcherConfig.queries,
        requiredKeywordGroups: watcherConfig.requiredKeywordGroups,
        requiredKeywordScope: watcherConfig.requiredKeywordScope,
        requiredTitleKeywords: watcherConfig.requiredTitleKeywords,
        excludedTitleKeywords: watcherConfig.excludedTitleKeywords ?? [],
        contracts: watcherConfig.contracts,
        minDailyRate: watcherConfig.minDailyRate,
        remote: watcherConfig.remote,
        locations: watcherConfig.locations,
        excludedKeywords: watcherConfig.excludedKeywords,
        maxPages: watcherConfig.maxPages,
      };

      watchers.push({
        name: watcherConfig.name,
        provider,
        filters,
        notifiers: [
          createNotifier({
            webhookUrl,
            mentionHere: watcherConfig.mentionHere ?? false,
            timeoutMs: config.runtime.requestTimeoutMs,
          }),
        ],
      });

      logger.info(
        {
          excludedKeywordCount: filters.excludedKeywords.length,
          maxPages: filters.maxPages,
          providerId,
          queryCount: filters.queries.length,
          watcherName: watcherConfig.name,
          webhookEnv: watcherConfig.webhookEnv,
        },
        "watcher configured",
      );
    }
  }

  return watchers;
}
