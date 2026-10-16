import { matchOffer } from "./filters/match-offer.js";
import type { Notifier } from "./notifications/notifier.js";
import type { JobProvider } from "./providers/provider.js";
import { logger } from "./shared/logger.js";
import type { JobOffer, ProviderSearchFilters } from "./shared/types.js";
import type { SeenOffersStore } from "./state/seen-offers-store.js";

const NOTIFICATION_BATCH_SIZE = 10;

export type CheckNewOffersSummary = {
  found: number;
  matched: number;
  unseen: number;
  notified: number;
  failedSearches?: number;
};

export type JobWatcher = {
  name: string;
  provider: JobProvider;
  filters: ProviderSearchFilters;
  notifiers: Notifier[];
};

type CheckNewOffersInput = {
  watchers: JobWatcher[];
  seenOffersStore: SeenOffersStore;
  maxNotificationsPerRun?: number;
};

export async function checkNewOffers({
  watchers,
  seenOffersStore,
  maxNotificationsPerRun = Number.POSITIVE_INFINITY,
}: CheckNewOffersInput): Promise<CheckNewOffersSummary> {
  const summary: CheckNewOffersSummary = {
    found: 0,
    matched: 0,
    unseen: 0,
    notified: 0,
  };
  let remainingNotificationBudget = maxNotificationsPerRun;

  logger.info(
    {
      watcherCount: watchers.length,
    },
    "job check started",
  );

  for (const watcher of watchers) {
    logger.info(
      {
        excludedKeywordCount: watcher.filters.excludedKeywords.length,
        maxPages: watcher.filters.maxPages,
        minDailyRate: watcher.filters.minDailyRate,
        notifierCount: watcher.notifiers.length,
        providerId: watcher.provider.id,
        queryCount: watcher.filters.queries.length,
        watcherName: watcher.name,
      },
      "watcher check started",
    );

    let offers: JobOffer[];
    try {
      offers = await watcher.provider.search(watcher.filters);
    } catch (error) {
      summary.failedSearches = (summary.failedSearches ?? 0) + 1;
      logger.error(
        {
          err: error,
          providerId: watcher.provider.id,
          watcherName: watcher.name,
        },
        "provider search failed; continuing other watchers",
      );
      continue;
    }
    const matchingOffers = offers.filter((offer) =>
      matchOffer(offer, watcher.filters),
    );
    const unseenOffers = await seenOffersStore.getUnseenOffers(
      matchingOffers,
      watcher.name,
    );
    const offersToNotify = unseenOffers.slice(0, remainingNotificationBudget);

    summary.found += offers.length;
    summary.matched += matchingOffers.length;
    summary.unseen += unseenOffers.length;

    logger.info(
      {
        found: offers.length,
        matched: matchingOffers.length,
        providerId: watcher.provider.id,
        unseen: unseenOffers.length,
        watcherName: watcher.name,
      },
      "watcher check filtered offers",
    );

    if (unseenOffers.length > offersToNotify.length) {
      logger.info(
        {
          queuedCount: unseenOffers.length - offersToNotify.length,
          remainingNotificationBudget,
          watcherName: watcher.name,
        },
        "notification budget reached; leaving offers queued",
      );
    }

    const batches = chunkOffers(offersToNotify, NOTIFICATION_BATCH_SIZE);

    for (const [batchIndex, batch] of batches.entries()) {
      logger.info(
        {
          batchIndex: batchIndex + 1,
          batchSize: batch.length,
          batchTotal: batches.length,
          notifierCount: watcher.notifiers.length,
          providerId: watcher.provider.id,
          watcherName: watcher.name,
        },
        "notification batch started",
      );

      for (const notifier of watcher.notifiers) {
        await notifier.notify(batch);
      }

      await seenOffersStore.markSeen(batch, watcher.name);
      summary.notified += batch.length;
      remainingNotificationBudget -= batch.length;

      logger.info(
        {
          batchIndex: batchIndex + 1,
          batchSize: batch.length,
          batchTotal: batches.length,
          providerId: watcher.provider.id,
          watcherName: watcher.name,
        },
        "notification batch completed",
      );
    }
  }

  logger.info(summary, "job check finished");

  return summary;
}

function chunkOffers<T>(offers: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < offers.length; index += size) {
    chunks.push(offers.slice(index, index + size));
  }

  return chunks;
}
