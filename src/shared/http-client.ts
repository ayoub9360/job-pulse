import { setTimeout as sleep } from "node:timers/promises";
import { type AppLogger, logger as defaultLogger } from "./logger.js";

export type FetchText = (url: URL) => Promise<string>;
type FetchLike = (url: URL, init?: RequestInit) => Promise<Response>;
type HttpClientConfig = {
  userAgent: string;
  timeoutMs: number;
  retryCount: number;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  logger?: AppLogger;
  sleepImpl?: (ms: number) => Promise<void>;
};

export function createHttpClient({
  userAgent,
  timeoutMs,
  retryCount,
  headers = {},
  fetchImpl = globalThis.fetch,
  logger = defaultLogger,
  sleepImpl = sleep,
}: HttpClientConfig): FetchText {
  return async (url) => {
    // Never log query strings, credentials, response bodies or upstream errors.
    const safeUrl = url.origin;
    for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
      let response: Response | undefined;
      let retryable = true;
      let delay = 500 * 2 ** (attempt - 1);
      try {
        response = await fetchImpl(url, {
          headers: { ...headers, "user-agent": userAgent },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
        if (response.ok) return await response.text();
        retryable = response.status === 429 || response.status >= 500;
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter !== null) {
          const seconds = Number(retryAfter);
          const parsed = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(parsed)) delay = Math.max(0, parsed);
        }
        await response.body?.cancel();
      } catch {
        // Fetch errors may contain private URLs or headers: discard their text.
      }
      const willRetry = retryable && attempt <= retryCount && delay <= 60_000;
      logger.warn(
        {
          attempt,
          maxAttempts: retryCount + 1,
          status: response?.status,
          url: safeUrl,
        },
        willRetry ? "http request failed; retrying" : "http request failed",
      );
      if (!willRetry)
        throw new Error(
          `HTTP request failed${response ? ` with status ${response.status}` : " or timed out"}`,
        );
      await sleepImpl(delay);
    }
    throw new Error("HTTP request failed");
  };
}
