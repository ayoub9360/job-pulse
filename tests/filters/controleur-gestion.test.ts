import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";
import { matchOffer } from "../../src/filters/match-offer.js";
import { parseCollectiveProject } from "../../src/providers/collective/collective.parser.js";
import { createWatchers } from "../../src/runtime/create-watchers.js";

const config = await loadConfig("tests/fixtures/watchers.yaml");
const filters = config.watchers.find((w) => w.name === "contracts");
if (!filters) throw new Error("Missing controller watcher");
const offer = (
  name: string,
  contractTypes = ["FULL_TIME"],
  description = "Pilotage du contrôle de gestion, budgets et reporting.",
) =>
  parseCollectiveProject({
    id: "controller",
    slug: "controller",
    name,
    contractTypes,
    description,
  });

describe("contrôleur de gestion", () => {
  it.each([
    "Contrôleur de Gestion H/F",
    "Assistant contrôleur de gestion",
    "Assistante contrôle de gestion",
    "Contrôleur de gestion junior",
    "Contrôleuse de gestion confirmée",
    "Contrôleuse de gestion industrielle",
    "Contrôleur(-se) de gestion (fonction logistique)",
    "Contrôleur.se de gestion, Département Budget",
    "Responsable Contrôle de Gestion Senior",
    "Business Controller LAM Northern Region",
    "Management Controller",
    "Consultant contrôle de gestion & cost allocation | Protection & IFRS 17",
    "Contrôle de gestion - Excel - Odoo",
  ])("accepts CDI: %s", (title) => {
    expect(matchOffer(offer(title), filters)).toBe(true);
  });
  it.each([
    "Consultant MOA Tagetik | Contrôle de Gestion & Transformation Finance",
    "MOA Senior Contrôle de Gestion",
    "Consultant Fonctionnel JDE - Finance & Contrôle de Gestion",
    "Consultant SAP S/4HANA",
    "Consultant Power BI – reporting budgétaire",
    "Analytics Engineer Finance",
    "Contrôleur qualité",
    "Contrôleur financier",
    "Document Controller",
    "Comptable général",
    "Stage - Contrôleur de Gestion F/H",
    "Contrôleur(se) de gestion H/F – CDD 3 mois",
    "Alternance Contrôle de gestion",
    "Business Controller fixed-term",
    "Contrôleur de gestion intérim",
  ])("rejects false positive: %s", (title) => {
    expect(matchOffer(offer(title), filters)).toBe(false);
  });
  it.each([
    "FREELANCE",
    "TEMPORARY",
    "INTERNSHIP",
    "APPRENTICESHIP",
    "CONTRACT",
  ])("rejects unsupported contract %s", (contract) => {
    expect(
      matchOffer(offer("Contrôleur de gestion", [contract]), filters),
    ).toBe(false);
  });
  it.each([
    "Contrat de travail : Le poste est ouvert en CDD de 3 mois renouvelable.",
    "Le poste à pourvoir est en CDD dès que possible.",
    "Rythme de travail CDD de 6 mois Temps plein.",
    "Conditions : Intérim 16 € - 18 € par heure Temps Plein.",
  ])("rejects mislabeled full-time offer: %s", (description) => {
    expect(
      matchOffer(
        offer("Contrôleur de gestion", ["FULL_TIME"], description),
        filters,
      ),
    ).toBe(false);
  });
  it("retains mentions of tools and prior internships and has no salary/location restrictions", () => {
    const job = offer(
      "Contrôleur de gestion",
      ["FULL_TIME"],
      "SAP, SQL, Java, Power BI ; expérience de 3 ans (alternance comprise), suivi des dépenses d’intérim.",
    );
    expect(
      matchOffer(
        { ...job, location: "Bruxelles", dailyRate: { min: 200, max: 300 } },
        filters,
      ),
    ).toBe(true);
    expect(filters.minDailyRate).toBeNull();
    expect(filters.remote).toEqual([]);
    expect(filters.locations).toEqual([]);
  });
  it("routes both providers to the new dedicated webhook", () => {
    const urls: string[] = [];
    const watchers = createWatchers({
      config: { ...config, watchers: [filters] },
      env: {
        TEST_CONTRACT_WEBHOOK: "https://example.test/controller",
      },
      providersById: {
        "free-work": { id: "free-work", search: async () => [] },
        collective: { id: "collective", search: async () => [] },
      },
      createNotifier: ({ webhookUrl }) => {
        urls.push(webhookUrl);
        return { notify: async () => {} };
      },
    });
    expect(watchers).toHaveLength(2);
    expect(watchers.map((w) => w.filters)).toEqual([
      expect.objectContaining({ contracts: ["cdi"] }),
      expect.objectContaining({ contracts: ["cdi"] }),
    ]);
    expect(urls).toEqual([
      "https://example.test/controller",
      "https://example.test/controller",
    ]);
  });
});
