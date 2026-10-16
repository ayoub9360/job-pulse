import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export type PostJson = (url: string, body: unknown) => Promise<unknown>;

class CurlRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function createCurlClient(options: {
  userAgent: string;
  timeoutMs: number;
  retryCount: number;
}): PostJson {
  return async (url, body) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const output = await new Promise<string>((resolve, reject) => {
          // No shell, cookies, credentials or user curl configuration. Body via stdin.
          const child = execFile(
            "curl",
            [
              "-q",
              "--silent",
              "--show-error",
              "--proto",
              "=http,https",
              "--max-time",
              String(options.timeoutMs / 1000),
              "--user-agent",
              options.userAgent,
              "--header",
              "accept: application/json",
              "--header",
              "content-type: application/json",
              "--header",
              "origin: https://www.collective.work",
              "--header",
              "referer: https://www.collective.work/",
              "--data-binary",
              "@-",
              "--write-out",
              "\n%{http_code}",
              "--url",
              url,
            ],
            { timeout: options.timeoutMs + 1000, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout) => {
              if (error) {
                reject(
                  new CurlRequestError(
                    error.code === "ENOENT"
                      ? "curl is not installed"
                      : `curl request failed (${error.code ?? "timeout"})`,
                    error.code !== "ENOENT" &&
                      error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
                  ),
                );
              } else resolve(stdout);
            },
          );
          child.stdin?.on("error", () => {
            /* Process completion reports the error. */
          });
          child.stdin?.end(JSON.stringify(body));
        });
        const split = output.lastIndexOf("\n");
        const status = Number(output.slice(split + 1));
        if (status < 200 || status >= 300 || !Number.isFinite(status)) {
          throw new CurlRequestError(
            `Collective HTTP ${status}`,
            status === 429 || status >= 500,
          );
        }
        try {
          return JSON.parse(output.slice(0, split));
        } catch {
          throw new CurlRequestError("Collective returned invalid JSON", false);
        }
      } catch (error) {
        if (
          !(error instanceof CurlRequestError) ||
          !error.retryable ||
          attempt >= options.retryCount
        )
          throw error;
        await sleep(500 * 2 ** attempt);
      }
    }
  };
}
