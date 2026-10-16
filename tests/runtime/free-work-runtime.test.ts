import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import YAML from "yaml";

it("runs all three Free-Work watchers, filters fullstack and does not notify twice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "free-work-runtime-"));
  const fixtureHtml = await readFile(
    join(process.cwd(), "tests/fixtures/free-work-search-current.html"),
    "utf8",
  );
  const html = fixtureHtml.replace(
    "</body>",
    `
    <a href="/fr/tech-it/job-mission/sap/noisy"><header><span class="tag">Freelance</span></header><h3>Chef de Projet SAP</h3><div>700-800 €</div><div class="line-clamp-3">Migration en vue du déploiement.</div></a>
    <a href="/fr/tech-it/job-mission/cloud/noisy"><header><span class="tag">Freelance</span></header><h3>Tech Lead Cloud</h3><div>500-550 €</div><span class="bg-brand-75">Vue.js</span></a>
    </body>`,
  );
  const notifications: Array<{ path: string; embeds: unknown[] }> = [];
  const fullstackHtml = [
    ["react-node", "Fullstack React Node.js"],
    ["nuxt-python", "Full stack Nuxt FastAPI"],
    ["angular-python", "Fullstack Angular Python"],
    ["react-only", "Full-stack React"],
  ]
    .map(
      ([id, title]) =>
        `<a href="/fr/tech-it/job-mission/fullstack/${id}"><header><span class="tag">Freelance</span></header><h3>${title}</h3><div>500-600 €</div></a>`,
    )
    .join("");
  let searchCount = 0;
  const searchUrls: URL[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      notifications.push({
        path: request.url ?? "",
        embeds: JSON.parse(body).embeds,
      });
      response.writeHead(204).end();
    } else {
      searchCount++;
      searchUrls.push(new URL(request.url ?? "", "http://localhost"));
      const query = searchUrls.at(-1)?.searchParams.get("query");
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          ["fullstack", "full stack", "full-stack"].includes(query ?? "")
            ? fullstackHtml
            : html,
        );
    }
  });

  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing server address");
    const origin = `http://127.0.0.1:${address.port}`;
    const config = YAML.parse(
      await readFile("tests/fixtures/watchers.yaml", "utf8"),
    );
    expect(
      config.watchers.map((watcher: { provider: string }) => watcher.provider),
    ).toEqual(Array.from({ length: 5 }, () => ["free-work", "collective"]));
    for (const watcher of config.watchers) watcher.provider = "free-work";
    config.watchers = config.watchers.filter((watcher: { name: string }) =>
      ["frontend", "data", "fullstack"].includes(watcher.name),
    );
    config.providers.freeWork.baseUrl = `${origin}/fr/tech-it/jobs`;
    const configPath = join(dir, "config.yaml");
    await writeFile(configPath, YAML.stringify(config));
    const run = () =>
      promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "src/main.ts", "--once"],
        {
          cwd: process.cwd(),
          timeout: 10_000,
          env: {
            ...process.env,
            PYLOTE_API_KEY: "",
            DOTENV_CONFIG_PATH: join(dir, "absent.env"),
            CONFIG_PATH: configPath,
            STATE_PATH: join(dir, "seen.json"),
            TEST_FRONTEND_WEBHOOK: `${origin}/frontend`,
            TEST_DATA_WEBHOOK: `${origin}/data`,
            TEST_FULLSTACK_WEBHOOK: `${origin}/fullstack`,
            LOG_LEVEL: "error",
          },
        },
      );

    await run();
    expect(searchCount).toBe(8);
    expect(searchUrls.every((url) => !url.searchParams.has("locations"))).toBe(
      true,
    );
    expect(notifications.map((notification) => notification.path)).toEqual([
      "/frontend",
      "/data",
      "/fullstack",
    ]);
    const frontendEmbeds = notifications.find(
      (notification) => notification.path === "/frontend",
    )?.embeds;
    expect(frontendEmbeds).not.toContainEqual(
      expect.objectContaining({ title: "Chef de Projet SAP" }),
    );
    expect(frontendEmbeds).not.toContainEqual(
      expect.objectContaining({ title: "Tech Lead Cloud" }),
    );
    expect(
      notifications.find((notification) => notification.path === "/fullstack")
        ?.embeds,
    ).toEqual([
      expect.objectContaining({ title: "Fullstack React Node.js" }),
      expect.objectContaining({ title: "Full stack Nuxt FastAPI" }),
    ]);
    expect(
      notifications.every((notification) => notification.embeds.length > 0),
    ).toBe(true);
    const sentCount = notifications.length;
    await run();
    expect(searchCount).toBe(16);
    expect(notifications).toHaveLength(sentCount);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
