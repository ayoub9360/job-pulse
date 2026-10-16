import { beforeAll, describe, expect, it } from "vitest";
import { appConfigSchema } from "../../src/config/config.schema.js";
import { loadConfig } from "../../src/config/load-config.js";
import { matchOffer } from "../../src/filters/match-offer.js";
import type {
  JobOffer,
  ProviderSearchFilters,
} from "../../src/shared/types.js";

let filters: ProviderSearchFilters;
const offer: JobOffer = {
  provider: "free-work",
  providerOfferId: "/fullstack/test",
  title: "Développeur fullstack",
  company: "ACME",
  url: "https://www.free-work.com/fr/tech-it/job-mission/fullstack/test",
  publishedAt: null,
  contractTypes: ["freelance"],
  dailyRate: { min: 450, max: 550 },
  remote: "unknown",
  location: "Bruxelles, Belgique",
  skills: [],
  description: null,
};

beforeAll(async () => {
  const config = await loadConfig("tests/fixtures/watchers.yaml");
  const watcher = config.watchers.find((entry) => entry.name === "fullstack");
  if (!watcher) throw new Error("Missing fullstack watcher");
  filters = watcher;
});

describe("fullstack stack requirements", () => {
  it.each([
    "React",
    "ReactJS",
    "React.js",
    "Next",
    "NextJS",
    "Next.js",
    "Vue",
    "VueJS",
    "Vue.js",
    "Nuxt",
    "NuxtJS",
    "Nuxt.js",
  ])("accepts %s with Node.js", (frontend) => {
    expect(
      matchOffer({ ...offer, skills: [frontend, "Node.js"] }, filters),
    ).toBe(true);
  });

  it.each([
    "Node",
    "NodeJS",
    "Node.js",
    "Nest",
    "NestJS",
    "Nest.js",
    "Express",
    "ExpressJS",
    "Express.js",
    "Python",
    "FastAPI",
    "Fast API",
    "Fastify",
  ])("accepts React with %s", (backend) => {
    expect(
      matchOffer(
        { ...offer, description: `Stack : React et ${backend}` },
        filters,
      ),
    ).toBe(true);
  });

  it.each([
    ["Angular", "Python"],
    ["Svelte", "Node.js"],
    ["Python"],
    ["React"],
    [],
    ["React", "Java"],
    ["React", "PHP"],
    ["React", "nested"],
    ["React", "expressions"],
    ["interview", "Python"],
  ])("rejects a missing or unsupported frontend/backend: %j", (...skills) => {
    expect(matchOffer({ ...offer, skills }, filters)).toBe(false);
  });

  it("does not mistake company/location names for a frontend technology", () => {
    expect(
      matchOffer(
        { ...offer, company: "Next", location: "Vue", skills: ["Python"] },
        filters,
      ),
    ).toBe(false);
  });

  it("keeps JavaScript but excludes the whole word Java", () => {
    expect(
      matchOffer(
        { ...offer, skills: ["React", "Node.js", "JavaScript"] },
        filters,
      ),
    ).toBe(true);
    expect(
      matchOffer({ ...offer, skills: ["React", "Node.js", "Java"] }, filters),
    ).toBe(false);
  });

  it.each(["fullstack", "full stack", "full-stack"])(
    "accepts the role spelling %s",
    (role) => {
      expect(
        matchOffer(
          { ...offer, title: `Développeur ${role} Vue Python` },
          filters,
        ),
      ).toBe(true);
    },
  );

  it("rejects a backend-only role even if it mentions React", () => {
    expect(
      matchOffer(
        { ...offer, title: "Développeur backend React Python" },
        filters,
      ),
    ).toBe(false);
  });

  it("leaves the data watcher without mandatory stack groups", async () => {
    const config = await loadConfig("tests/fixtures/watchers.yaml");
    expect(
      config.watchers
        .filter((watcher) => watcher.name === "data")
        .every((watcher) => watcher.requiredKeywordGroups.length === 0),
    ).toBe(true);
  });

  it("rejects empty keyword groups and blank required keywords", async () => {
    const config = await loadConfig("tests/fixtures/watchers.yaml");
    for (const requiredKeywordGroups of [[[]], [[" "]]]) {
      expect(
        appConfigSchema.safeParse({
          ...config,
          watchers: [{ ...config.watchers[0], requiredKeywordGroups }],
        }).success,
      ).toBe(false);
    }
  });
});
