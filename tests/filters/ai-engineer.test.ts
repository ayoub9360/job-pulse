import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";
import { matchOffer } from "../../src/filters/match-offer.js";
import { createWatchers } from "../../src/runtime/create-watchers.js";
import type { JobOffer } from "../../src/shared/types.js";

const config = await loadConfig("tests/fixtures/watchers.yaml");
const filters = config.watchers.find((w) => w.name === "groups");
if (!filters) throw new Error("Missing AI engineer watcher");
const offer: JobOffer = {
  provider: "free-work",
  providerOfferId: "ai-example",
  title: "Développeur Fullstack IA",
  company: "ACME",
  url: "https://example.test/ai-example",
  publishedAt: null,
  contractTypes: ["freelance"],
  dailyRate: { min: null, max: null },
  remote: "partial",
  location: "Example City",
  skills: ["Python", "React", "GCP", "Vertex AI", "Google ADK"],
  description:
    "Synthetic example: build RAG agents in Python with data scientists and architects.",
};

describe("AI application development", () => {
  it("accepts the synthetic fullstack Python/React/GCP mission", () => {
    expect(matchOffer(offer, filters)).toBe(true);
  });

  it.each([
    ["AI Engineer", "Python", "RAG"],
    ["Ingénieure IA", "Python", "Google ADK"],
    ["Développeur backend", "FastAPI", "LangGraph"],
    ["Full-stack developer", "TypeScript", "LLMs"],
    ["Software Engineer", "Node.js", "AI agents"],
    ["Product Engineer", "React", "GenAI"],
    ["Consultant développeur IA", "Python", "LangChain"],
    ["Développeuse", "Python", "retrieval-augmented generation"],
  ])("accepts %s with %s and %s", (title, stack, signal) => {
    expect(
      matchOffer(
        {
          ...offer,
          title,
          skills: [stack],
          description: signal,
          location: "Lyon",
          remote: "onsite",
        },
        filters,
      ),
    ).toBe(true);
  });

  it.each([
    "Data Scientist GenAI",
    "Data Engineer Python RAG",
    "Architecte IA / AI Engineer",
    "Chef de projet IA",
    "Consultant stratégie IA",
    "Research Scientist LLM",
    "Stage AI Engineer",
    "Alternance développeur IA",
    "Ingénieur commercial IA",
  ])("rejects unrelated role: %s", (title) => {
    expect(matchOffer({ ...offer, title }, filters)).toBe(false);
  });

  it.each([
    "Application React/Python pour une entreprise IA sur GCP et Vertex AI",
    "Utilisation de ChatGPT et GitHub Copilot pour coder",
    "Migration et défragmentation des bases de données",
    "Machine learning, entraînement de modèles et statistiques",
  ])("rejects missing applied AI signal: %s", (description) => {
    expect(
      matchOffer(
        { ...offer, skills: ["Python", "React"], description },
        filters,
      ),
    ).toBe(false);
  });

  it("requires a development stack, not just a no-code agent tool", () => {
    expect(
      matchOffer(
        { ...offer, skills: ["n8n"], description: "Agents IA et RAG" },
        filters,
      ),
    ).toBe(false);
  });

  it("ignores company/location as evidence of AI experience", () => {
    expect(
      matchOffer(
        {
          ...offer,
          company: "RAG",
          location: "LangChain",
          skills: ["Python"],
          description: null,
        },
        filters,
      ),
    ).toBe(false);
  });

  it("enforces freelance and the existing rate semantics", () => {
    expect(matchOffer({ ...offer, contractTypes: ["cdi"] }, filters)).toBe(
      false,
    );
    expect(
      matchOffer({ ...offer, dailyRate: { min: 350, max: 449 } }, filters),
    ).toBe(false);
    expect(
      matchOffer({ ...offer, dailyRate: { min: 400, max: 500 } }, filters),
    ).toBe(true);
  });

  it("routes both providers through the dedicated webhook and preserves filters", () => {
    const urls: string[] = [];
    const watchers = createWatchers({
      config: { ...config, watchers: [filters] },
      env: { TEST_GROUP_WEBHOOK: "https://example.test/ai" },
      providersById: {
        "free-work": { id: "free-work", search: async () => [] },
        collective: { id: "collective", search: async () => [] },
      },
      createNotifier: ({ webhookUrl }) => {
        urls.push(webhookUrl);
        return { notify: async () => {} };
      },
    });
    expect(urls).toEqual([
      "https://example.test/ai",
      "https://example.test/ai",
    ]);
    for (const watcher of watchers) {
      expect(matchOffer(offer, watcher.filters)).toBe(true);
      expect(
        matchOffer({ ...offer, title: "Data Scientist" }, watcher.filters),
      ).toBe(false);
    }
  });
});
