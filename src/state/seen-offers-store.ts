import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type AppLogger, logger as defaultLogger } from "../shared/logger.js";
import type { JobOffer } from "../shared/types.js";

type SeenOffersFile = {
  seenOfferIds: string[];
  updatedAt: string;
};

export class SeenOffersStore {
  private readonly statePath: string;
  private readonly logger: AppLogger;

  constructor(statePath: string, logger = defaultLogger) {
    this.statePath = statePath;
    this.logger = logger;
  }

  async getUnseenOffers(
    offers: JobOffer[],
    watcherName?: string,
  ): Promise<JobOffer[]> {
    const seenOfferIds = await this.readSeenOfferIds();

    const unseenOffers = offers.filter(
      (offer) => !seenOfferIds.has(getSeenOfferKey(offer, watcherName)),
    );

    this.logger.debug(
      {
        offeredCount: offers.length,
        seenCount: seenOfferIds.size,
        statePath: this.statePath,
        unseenCount: unseenOffers.length,
        watcherName,
      },
      "seen offers filtered",
    );

    return unseenOffers;
  }

  async markSeen(offers: JobOffer[], watcherName?: string): Promise<void> {
    if (offers.length === 0) {
      return;
    }

    const seenOfferIds = await this.readSeenOfferIds();

    for (const offer of offers) {
      seenOfferIds.add(getSeenOfferKey(offer, watcherName));
    }

    await this.writeSeenOfferIds(seenOfferIds);

    this.logger.info(
      {
        markedCount: offers.length,
        seenCount: seenOfferIds.size,
        statePath: this.statePath,
        watcherName,
      },
      "seen offers marked",
    );
  }

  private async readSeenOfferIds(): Promise<Set<string>> {
    try {
      const rawState = await readFile(this.statePath, "utf8");
      const parsedState = JSON.parse(rawState) as Partial<SeenOffersFile>;

      if (!Array.isArray(parsedState.seenOfferIds)) {
        throw new Error(`Invalid seen offers state: ${this.statePath}`);
      }

      return new Set(
        parsedState.seenOfferIds.filter(
          (value): value is string => typeof value === "string",
        ),
      );
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.logger.debug(
          {
            statePath: this.statePath,
          },
          "seen offers state not found",
        );
        return new Set();
      }

      throw error;
    }
  }

  private async writeSeenOfferIds(seenOfferIds: Set<string>): Promise<void> {
    const state: SeenOffersFile = {
      seenOfferIds: Array.from(seenOfferIds).sort(),
      updatedAt: new Date().toISOString(),
    };
    const tmpPath = `${this.statePath}.tmp`;

    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.statePath);
  }
}

function getSeenOfferKey(offer: JobOffer, watcherName?: string): string {
  if (watcherName) {
    return `${watcherName}:${offer.provider}:${offer.providerOfferId}`;
  }

  return `${offer.provider}:${offer.providerOfferId}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
