import { type AppLogger, logger as defaultLogger } from "../shared/logger.js";
import type { JobOffer, RemoteMode } from "../shared/types.js";
import type { Notifier } from "./notifier.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Sleep = (delayMs: number) => Promise<void>;

type DiscordNotifierInput = {
  webhookUrl: string;
  mentionHere?: boolean;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: AppLogger;
  sleep?: Sleep;
};

type DiscordEmbed = {
  title: string;
  url: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }>;
  footer: {
    text: string;
  };
};

type DiscordWebhookPayload = {
  content: string;
  embeds: DiscordEmbed[];
  allowed_mentions: {
    parse: Array<"everyone">;
  };
};

const DISCORD_MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_RATE_LIMIT_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT_DELAY_MS = 1_000;

export class DiscordNotifier implements Notifier {
  private readonly webhookUrl: string;
  private readonly mentionHere: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: AppLogger;
  private readonly sleep: Sleep;

  constructor({
    webhookUrl,
    mentionHere = false,
    timeoutMs = 10_000,
    fetchImpl = globalThis.fetch,
    logger = defaultLogger,
    sleep = wait,
  }: DiscordNotifierInput) {
    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch {
      throw new Error("Invalid webhook URL");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid webhook URL");
    this.webhookUrl = webhookUrl;
    this.mentionHere = mentionHere;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.sleep = sleep;
  }

  async notify(offers: JobOffer[]): Promise<void> {
    if (offers.length === 0) {
      this.logger.debug(
        {},
        "discord notification skipped because no offers were provided",
      );
      return;
    }

    const batches = chunkOffers(offers, DISCORD_MAX_EMBEDS_PER_MESSAGE);

    this.logger.info(
      {
        batchCount: batches.length,
        offerCount: offers.length,
      },
      "discord notification started",
    );

    for (const [batchIndex, batch] of batches.entries()) {
      this.logger.debug(
        {
          batchIndex: batchIndex + 1,
          batchSize: batch.length,
          batchTotal: batches.length,
        },
        "discord notification batch started",
      );

      await this.postWithRateLimitRetry(
        buildDiscordPayload(batch, this.mentionHere),
      );

      this.logger.info(
        {
          batchIndex: batchIndex + 1,
          batchSize: batch.length,
          batchTotal: batches.length,
        },
        "discord notification batch sent",
      );
    }
  }

  private async postWithRateLimitRetry(
    payload: DiscordWebhookPayload,
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.webhookUrl, {
          method: "POST",
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new Error("Discord request failed or timed out");
      }
      if (response.ok) {
        this.logger.debug(
          {
            attempt,
            embedCount: payload.embeds.length,
            maxAttempts: MAX_RATE_LIMIT_ATTEMPTS,
            status: response.status,
          },
          "discord webhook request succeeded",
        );
        return;
      }

      if (response.status === 429 && attempt < MAX_RATE_LIMIT_ATTEMPTS) {
        const delayMs = await getRateLimitDelayMs(response);
        if (delayMs > MAX_RETRY_DELAY_MS)
          throw new Error("Discord retry delay exceeds limit; try again later");

        this.logger.warn(
          {
            attempt,
            delayMs,
            maxAttempts: MAX_RATE_LIMIT_ATTEMPTS,
            status: response.status,
          },
          "discord rate limited; retrying",
        );

        await this.sleep(delayMs);
        continue;
      }

      this.logger.error(
        {
          attempt,
          embedCount: payload.embeds.length,
          maxAttempts: MAX_RATE_LIMIT_ATTEMPTS,
          status: response.status,
        },
        "discord notification failed",
      );

      throw new Error(
        `Discord notification failed with status ${response.status}`,
      );
    }
  }
}

function buildDiscordPayload(
  offers: JobOffer[],
  mentionHere: boolean,
): DiscordWebhookPayload {
  return {
    content: mentionHere ? "\n@here" : "",
    embeds: offers.map(buildDiscordEmbed),
    allowed_mentions: {
      parse: mentionHere ? ["everyone"] : [],
    },
  };
}

function buildDiscordEmbed(offer: JobOffer): DiscordEmbed {
  return {
    title: offer.title.slice(0, 256) || "Untitled offer",
    url: offer.url,
    color: 5_763_719,
    fields: [
      {
        name: "📍 Localisation",
        value: offer.location?.slice(0, 128) || "Lieu inconnu",
        inline: true,
      },
      {
        name: "💰 TJM",
        value: formatDailyRate(offer),
        inline: true,
      },
      {
        name: "💻 Remote",
        value: formatRemoteMode(offer.remote),
        inline: true,
      },
    ],
    footer: {
      text: {
        "free-work": "Free-Work",
        pylote: "Pylote",
        collective: "Collective",
      }[offer.provider],
    },
  };
}

function formatDailyRate(offer: JobOffer): string {
  const { min, max } = offer.dailyRate;

  if (min !== null && max !== null) {
    return min === max ? `${min} €/jour` : `${min}–${max} €/jour`;
  }

  if (min !== null) {
    return `À partir de ${min} €/jour`;
  }

  if (max !== null) {
    return `Jusqu’à ${max} €/jour`;
  }

  return "TJM inconnu";
}

function formatRemoteMode(remote: RemoteMode): string {
  switch (remote) {
    case "full":
      return "Teletravail 100%";
    case "partial":
      return "Teletravail partiel";
    case "onsite":
      return "Presentiel";
    case "unknown":
      return "Teletravail inconnu";
  }
}

async function getRateLimitDelayMs(response: Response): Promise<number> {
  const headerDelay =
    parseRetryAfterHeader(response.headers.get("retry-after")) ??
    parseRetryAfterHeader(response.headers.get("x-ratelimit-reset-after"));

  if (headerDelay !== null) {
    return headerDelay;
  }

  const bodyDelay = await parseRetryAfterBody(response);

  return bodyDelay ?? DEFAULT_RATE_LIMIT_DELAY_MS;
}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, timestamp - Date.now());
}

async function parseRetryAfterBody(response: Response): Promise<number | null> {
  try {
    const body: unknown = await response.clone().json();

    if (!body || typeof body !== "object" || !("retry_after" in body)) {
      return null;
    }

    const retryAfter = (body as { retry_after?: unknown }).retry_after;
    const seconds = Number(retryAfter);

    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }

    return Math.ceil(seconds * 1_000);
  } catch {
    return null;
  }
}

function chunkOffers<T>(offers: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < offers.length; index += size) {
    chunks.push(offers.slice(index, index + size));
  }

  return chunks;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
