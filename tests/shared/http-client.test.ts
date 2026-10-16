import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/shared/http-client.js";
import type { AppLogger } from "../../src/shared/logger.js";

describe("createHttpClient", () => {
  it("fetches text with the configured user agent", async () => {
    const requestedHeaders: HeadersInit[] = [];
    const fetchText = createHttpClient({
      userAgent: "job-pulse/test",
      timeoutMs: 1_000,
      retryCount: 0,
      fetchImpl: async (_url, init) => {
        requestedHeaders.push(init?.headers ?? {});
        return new Response("ok");
      },
    });

    await expect(fetchText(new URL("https://example.com"))).resolves.toBe("ok");
    expect(new Headers(requestedHeaders[0]).get("user-agent")).toBe(
      "job-pulse/test",
    );
  });

  it("fetches text with additional configured headers", async () => {
    const requestedHeaders: HeadersInit[] = [];
    const fetchText = createHttpClient({
      userAgent: "job-pulse/test",
      timeoutMs: 1_000,
      retryCount: 0,
      headers: {
        authorization: "Bearer pylk_test",
      },
      fetchImpl: async (_url, init) => {
        requestedHeaders.push(init?.headers ?? {});
        return new Response("ok");
      },
    });

    await fetchText(new URL("https://example.com"));

    expect(new Headers(requestedHeaders[0]).get("authorization")).toBe(
      "Bearer pylk_test",
    );
  });

  it("retries failed HTTP responses", async () => {
    let calls = 0;
    const fetchText = createHttpClient({
      userAgent: "job-pulse/test",
      timeoutMs: 1_000,
      retryCount: 1,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? new Response("bad", { status: 503 })
          : new Response("ok");
      },
    });

    await expect(fetchText(new URL("https://example.com"))).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("logs failed attempts before retrying", async () => {
    const warnings: Array<{
      context: Record<string, unknown>;
      message: string;
    }> = [];
    let calls = 0;
    const fetchText = createHttpClient({
      userAgent: "job-pulse/test",
      timeoutMs: 1_000,
      retryCount: 1,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: (context, message) => {
          warnings.push({ context, message });
        },
        error: () => undefined,
      } as AppLogger,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? new Response("bad", { status: 503 })
          : new Response("ok");
      },
    });

    await fetchText(new URL("https://example.com/jobs"));

    expect(warnings).toEqual([
      {
        context: {
          attempt: 1,
          maxAttempts: 2,
          status: 503,
          url: "https://example.com",
        },
        message: "http request failed; retrying",
      },
    ]);
  });
});
