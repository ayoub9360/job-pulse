import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import YAML from "yaml";
import { createCurlClient } from "../../src/shared/curl-client.js";

it("runs curl anonymously alongside Free-Work, routes categories and preserves seen state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collective-runtime-"));
  const notifications: Array<{
    path: string;
    titles: string[];
    footer: string;
  }> = [];
  let requests = 0;
  let cookies = false;
  const server = createServer(async (req, res) => {
    if (req.url === "/graphql") {
      cookies ||= !!req.headers.cookie || !!req.headers.authorization;
      requests++;
      let body = "";
      for await (const chunk of req) body += chunk;
      const { variables } = JSON.parse(body);
      const term = variables.data.query;
      const data =
        term === "data engineer"
          ? ["data", "Data Engineer Python SQL", ["PYTHON", "SQL"]]
          : [
              "full",
              "Développeur fullstack React Node.js",
              ["REACT", "NODE_JS"],
            ];
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: {
            results: {
              projects: [
                {
                  id: data[0],
                  slug: data[0],
                  name: data[1],
                  projectTypes: data[2],
                  contractTypes: ["FREELANCE"],
                  budgetBrief: "400-500",
                },
              ],
              pagination: { from: 0, total: 1 },
            },
          },
        }),
      );
    } else if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const embeds = JSON.parse(body).embeds;
      notifications.push({
        path: req.url ?? "",
        titles: embeds.map((e: { title: string }) => e.title),
        footer: embeds[0].footer.text,
      });
      res.writeHead(204).end();
    } else res.end("<html></html>");
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const origin = `http://127.0.0.1:${address.port}`;
    const config = YAML.parse(
      await readFile("tests/fixtures/watchers.yaml", "utf8"),
    );
    config.watchers = config.watchers.filter((watcher: { name: string }) =>
      ["frontend", "data", "fullstack"].includes(watcher.name),
    );
    config.providers.freeWork.baseUrl = `${origin}/jobs`;
    config.providers.collective.baseUrl = `${origin}/graphql`;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(config));
    const run = () =>
      promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "src/main.ts", "--once"],
        {
          timeout: 15000,
          env: {
            ...process.env,
            CONFIG_PATH: join(dir, "config.yaml"),
            STATE_PATH: join(dir, "seen.json"),
            DOTENV_CONFIG_PATH: join(dir, "absent"),
            TEST_FRONTEND_WEBHOOK: `${origin}/front`,
            TEST_DATA_WEBHOOK: `${origin}/data`,
            TEST_FULLSTACK_WEBHOOK: `${origin}/full`,
            LOG_LEVEL: "error",
          },
        },
      );
    await run();
    expect(requests).toBe(8);
    expect(cookies).toBe(false);
    expect(notifications.map((n) => n.path)).toEqual([
      "/front",
      "/data",
      "/full",
    ]);
    expect(notifications.every((n) => n.footer === "Collective")).toBe(true);
    expect(notifications[0]?.titles).toEqual(notifications[2]?.titles);
    await run();
    expect(requests).toBe(16);
    expect(notifications).toHaveLength(3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

it("handles HTTP errors, retries, invalid JSON and curl timeouts", async () => {
  let count = 0;
  const server = createServer((req, res) => {
    if (req.url === "/retry") {
      count++;
      res.writeHead(count === 1 ? 503 : 200).end("{}");
    } else if (req.url === "/forbidden") res.writeHead(403).end("challenge");
    else if (req.url === "/invalid") res.end("<html>challenge</html>");
    else if (req.url === "/timeout") setTimeout(() => res.end("{}"), 300);
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const origin = `http://127.0.0.1:${address.port}`;
    const post = createCurlClient({
      userAgent: "test",
      timeoutMs: 1000,
      retryCount: 1,
    });
    await expect(post(`${origin}/retry`, {})).resolves.toEqual({});
    expect(count).toBe(2);
    await expect(post(`${origin}/forbidden`, {})).rejects.toThrow("HTTP 403");
    await expect(post(`${origin}/invalid`, {})).rejects.toThrow("invalid JSON");
    await expect(
      createCurlClient({ userAgent: "test", timeoutMs: 50, retryCount: 0 })(
        `${origin}/timeout`,
        {},
      ),
    ).rejects.toThrow("curl request failed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
