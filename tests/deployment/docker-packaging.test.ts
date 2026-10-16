import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import YAML from "yaml";

it("mounts user config read-only and accepts arbitrary webhook env names", async () => {
  const compose = YAML.parse(await readFile("docker-compose.yml", "utf8"));
  const service = compose.services["job-pulse"];
  expect(service.env_file).toBe(".env");
  expect(service.volumes[0]).toMatchObject({
    type: "bind",
    read_only: true,
    bind: { create_host_path: false },
  });
  const dockerfile = await readFile("Dockerfile", "utf8");
  expect(dockerfile).not.toMatch(/COPY config\/config\.yaml/);
  expect(dockerfile).toContain("USER node");
});
