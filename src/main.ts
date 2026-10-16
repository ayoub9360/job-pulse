import "dotenv/config";
import { checkNewOffers, type JobWatcher } from "./check-new-offers.js";
import type { AppConfig } from "./config/config.schema.js";
import { loadConfig } from "./config/load-config.js";
import { CollectiveProvider } from "./providers/collective/collective.provider.js";
import { FreeWorkProvider } from "./providers/free-work/free-work.provider.js";
import type { JobProvider } from "./providers/provider.js";
import { PyloteProvider } from "./providers/pylote/pylote.provider.js";
import { createWatchers } from "./runtime/create-watchers.js";
import { scheduleJob } from "./scheduler/schedule-job.js";
import { createCurlClient } from "./shared/curl-client.js";
import { createHttpClient } from "./shared/http-client.js";
import { logger } from "./shared/logger.js";
import type { ProviderId } from "./shared/types.js";
import { SeenOffersStore } from "./state/seen-offers-store.js";

const DEFAULT_STATE_PATH = "data/seen-offers.json";

async function main(): Promise<void> {
  const config = await loadConfig();
  const runtime = createRuntime(config, process.env);

  logger.info(
    {
      watcherCount: runtime.watchers.length,
      watcherNames: runtime.watchers.map((watcher) => watcher.name),
    },
    "watchers ready",
  );

  if (process.argv.includes("--once")) {
    await runCheck(runtime);
    return;
  }

  let activeRun: Promise<void> | undefined;
  let stopping = false;
  const task = scheduleJob({
    cronExpression: config.schedule.cron,
    timezone: config.schedule.timezone,
    run: async () => {
      try {
        if (stopping) return;
        activeRun = runCheck(runtime);
        await activeRun;
      } catch (error) {
        logger.error({ err: error }, "scheduled check failed");
      } finally {
        activeRun = undefined;
      }
    },
  });

  logger.info(
    {
      cron: config.schedule.cron,
      timezone: config.schedule.timezone,
      watcherCount: runtime.watchers.length,
    },
    "job watcher started",
  );

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    task.stop();
    const deadline = setTimeout(() => {
      logger.error({}, "shutdown deadline exceeded");
      process.exit(1);
    }, 30_000);
    deadline.unref();
    try {
      await activeRun;
    } catch {
      /* Already logged by the scheduled run. */
    }
    clearTimeout(deadline);
    logger.info({}, "job watcher stopped");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

function createRuntime(config: AppConfig, env: NodeJS.ProcessEnv): Runtime {
  const fetchText = createHttpClient({
    userAgent: config.runtime.userAgent,
    timeoutMs: config.runtime.requestTimeoutMs,
    retryCount: config.runtime.retryCount,
  });
  const providersById: Partial<Record<ProviderId, JobProvider>> = {};
  if (
    config.providers.freeWork &&
    config.watchers.some(
      (w) => w.enabled && [w.provider].flat().includes("free-work"),
    )
  ) {
    providersById["free-work"] = new FreeWorkProvider({
      baseUrl: config.providers.freeWork.baseUrl,
      fetchText,
    });
  }
  const usesPylote = config.watchers.some(
    (watcher) =>
      watcher.enabled && [watcher.provider].flat().includes("pylote"),
  );

  if (
    config.watchers.some(
      (watcher) =>
        watcher.enabled && [watcher.provider].flat().includes("collective"),
    )
  ) {
    const collective = config.providers.collective;
    if (!collective) throw new Error("Missing providers.collective config");
    providersById.collective = new CollectiveProvider({
      baseUrl: collective.baseUrl,
      postJson: createCurlClient({
        userAgent: collective.userAgent,
        timeoutMs: config.runtime.requestTimeoutMs,
        retryCount: config.runtime.retryCount,
      }),
    });
  }

  if (usesPylote) {
    const pyloteApiKey = env.PYLOTE_API_KEY;

    if (!pyloteApiKey) {
      throw new Error("Missing environment variable: PYLOTE_API_KEY");
    }

    if (!config.providers.pylote) {
      throw new Error("Missing providers.pylote config");
    }

    providersById.pylote = new PyloteProvider({
      baseUrl: config.providers.pylote.baseUrl,
      fetchText: createHttpClient({
        userAgent: config.runtime.userAgent,
        timeoutMs: config.runtime.requestTimeoutMs,
        retryCount: config.runtime.retryCount,
        headers: {
          authorization: `Bearer ${pyloteApiKey}`,
        },
      }),
    });
  }

  return {
    maxNotificationsPerRun: config.runtime.maxNotificationsPerRun,
    watchers: createWatchers({
      config,
      env,
      providersById,
    }),
    seenOffersStore: new SeenOffersStore(env.STATE_PATH ?? DEFAULT_STATE_PATH),
  };
}

async function runCheck(runtime: Runtime): Promise<void> {
  const summary = await checkNewOffers(runtime);

  logger.info(summary, "job check completed");
  if (
    runtime.watchers.length > 0 &&
    summary.failedSearches === runtime.watchers.length
  ) {
    throw new Error("All provider searches failed");
  }
}

type Runtime = {
  maxNotificationsPerRun: number;
  watchers: JobWatcher[];
  seenOffersStore: SeenOffersStore;
};

main().catch((error) => {
  logger.error({ err: error }, "job watcher failed");
  process.exit(1);
});
