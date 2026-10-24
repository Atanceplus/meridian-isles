import type { ContentPackInput } from "../schema";
import { CORE_SKILLS as S } from "./core";

/**
 * Final Expense product-line pack. Carrier names are the user's requested
 * labels only: no products, underwriting rules, commissions or corporate facts
 * ship with the app. Every carrier's role starts "unspecified" and is editable.
 */

const tier = (fullUpTo: number, reducedUpTo: number) => ({ fullUpTo, reducedUpTo, reducedRate: 0.5 });

const PK_GATES = [
  "fe:ach.pk.first-charts",
  "fe:ach.pk.navigators-log",
  "fe:ach.pk.cartographers-atlas",
  "fe:ach.pk.admiralty",
] as const;

export const finalExpensePack: ContentPackInput = {
  format: "meridian-pack",
  id: "fe",
  name: "Final Expense",
  version: "0.1.0",
  requires: [{ id: "core" }],

  islands: [
    {
      id: "fe:island.carrier-archipelago",
      name: "Carrier Archipelago",
      tagline: "Lift the fog from every stronghold.",
      skillIds: [S.productKnowledge],
      restorationSource: "carriers",
    },
  ],

  activityTypes: [
    {
      id: "fe:act.carrier-study",
      name: "Carrier / product study",
      islandId: "fe:island.carrier-archipelago",
      description: "Study one knowledge category for a carrier or product.",
      measure: "minutes",
      xpPerUnit: 2,
      skillWeights: { [S.productKnowledge]: 100 },
      // Per category per day, so one heavily studied subject can't carry a carrier.
      limits: { dailyPerSubject: tier(60, 120) },
      subjectKind: "knowledgeCategory",
      unitsField: "minutes",
      subjectFields: ["carrierId", "categoryId", "productId"],
      fields: [
        { key: "minutes", label: "Minutes", kind: "number", required: true, min: 1 },
        { key: "carrierId", label: "Carrier", kind: "select", required: true, source: "carriers" },
        { key: "categoryId", label: "Category", kind: "select", required: true, source: "knowledgeCategories" },
        { key: "productId", label: "Product (for product categories)", kind: "select", source: "products" },
        { key: "summary", label: "What did you learn?", kind: "longtext", required: true },
      ],
    },
    {
      id: "fe:act.app-navigation",
      name: "Application navigation practice",
      islandId: "fe:island.carrier-archipelago",
      description: "A timed run through a carrier's application flow.",
      measure: "runs",
      xpPerUnit: 15,
      personalBestBonus: 10,
      skillWeights: { [S.speed]: 50, [S.productKnowledge]: 50 },
      limits: { daily: tier(6, 10) },
      subjectKind: "carrier",
      minutesPerUnit: 10,
      subjectFields: ["carrierId", "productId"],
      timeField: "durationSeconds",
      cleanField: "completed",
      fields: [
        { key: "carrierId", label: "Carrier", kind: "select", required: true, source: "carriers" },
        { key: "productId", label: "Product", kind: "select", source: "products" },
        { key: "durationSeconds", label: "Time (seconds)", kind: "number", required: true, min: 1 },
        { key: "completed", label: "Completed without errors", kind: "boolean", required: true },
      ],
    },
    {
      id: "fe:act.underwriting-case",
      name: "Underwriting case drill",
      islandId: "fe:island.carrier-archipelago",
      description: "Work a hypothetical client's health profile against your own carrier notes.",
      measure: "reps",
      xpPerUnit: 5,
      skillWeights: { [S.productKnowledge]: 100 },
      limits: { daily: tier(12, 20) },
      minutesPerUnit: 4,
      unitsField: "reps",
      fields: [
        { key: "reps", label: "Cases worked", kind: "number", required: true, min: 1 },
        { key: "carrierIds", label: "Carriers considered", kind: "multiselect", source: "carriers" },
        { key: "notes", label: "Notes", kind: "longtext" },
      ],
    },
    {
      id: "fe:act.quote-practice",
      name: "Quote practice",
      islandId: "fe:island.carrier-archipelago",
      description: "Practice producing and presenting quotes quickly and accurately.",
      measure: "reps",
      xpPerUnit: 4,
      skillWeights: { [S.productKnowledge]: 50, [S.speed]: 50 },
      limits: { daily: tier(15, 25) },
      minutesPerUnit: 3,
      unitsField: "reps",
      fields: [
        { key: "reps", label: "Quotes", kind: "number", required: true, min: 1 },
        { key: "carrierIds", label: "Carriers", kind: "multiselect", source: "carriers" },
      ],
    },
  ],

  achievements: [
    { id: PK_GATES[0], name: "First Charts", skillId: S.productKnowledge, rank: 2, kind: "count", description: "First maps of two strongholds.", requirements: ["Carrier-wide categories at Surveyed or better for 2 carriers"] },
    { id: PK_GATES[1], name: "Navigator's Log", skillId: S.productKnowledge, rank: 3, kind: "composite", description: "Breadth before depth.", requirements: ["4 carriers with every applicable category at Surveyed or better", "1 product with every applicable category at Charted or better"] },
    { id: PK_GATES[2], name: "Cartographer's Atlas", skillId: S.productKnowledge, rank: 4, kind: "composite", description: "The archipelago, charted.", requirements: ["6 carriers with every applicable category at Charted or better", "3 of those carriers at Fluent", "Comparison Atlas filled in for at least 6 carriers"] },
    { id: PK_GATES[3], name: "Admiralty", skillId: S.productKnowledge, rank: 5, kind: "composite", description: "Command of every stronghold.", requirements: ["Every active carrier with every applicable category at Fluent or better", "4 carriers Mastered", "Every category reviewed within the last 120 days", "A recorded 10-minute teach-back on 3 carriers"] },
  ],

  gatePatches: PK_GATES.map((id, i) => ({ skillId: S.productKnowledge, rank: i + 2, achievementIds: [id] })),

  seeds: {
    carriers: [
      { id: "fe:carrier.americo", label: "Americo" },
      { id: "fe:carrier.mutual-of-omaha", label: "Mutual of Omaha" },
      { id: "fe:carrier.instabrain", label: "Instabrain" },
      { id: "fe:carrier.chubb", label: "Chubb" },
      { id: "fe:carrier.american-amicable", label: "American Amicable" },
      { id: "fe:carrier.transamerica", label: "Transamerica" },
      { id: "fe:carrier.corebridge", label: "Corebridge" },
      { id: "fe:carrier.aetna", label: "Aetna" },
    ],
    knowledgeCategories: [
      { id: "fe:cat.background", scope: "carrier", name: "Background & history", description: "Company background and history, in your own words." },
      { id: "fe:cat.processes", scope: "carrier", name: "Processes & resources", description: "General processes, portals, contacts and resources." },
      { id: "fe:cat.carrier-comp", scope: "carrier", name: "Carrier-level compensation", description: "Compensation knowledge that applies across the carrier.", canBeNotApplicable: true },
      { id: "fe:cat.products", scope: "product", name: "Products & differences", description: "Available products and how they differ." },
      { id: "fe:cat.eligibility", scope: "product", name: "Eligibility & underwriting", description: "Who qualifies and how underwriting decides." },
      { id: "fe:cat.medical", scope: "product", name: "Medical information considered", description: "Health questions, conditions and medications considered." },
      { id: "fe:cat.application", scope: "product", name: "Application process & navigation", description: "How to complete and submit the application." },
      { id: "fe:cat.features", scope: "product", name: "Features & limitations", description: "Benefits, riders, waiting periods and limitations." },
      { id: "fe:cat.commissions", scope: "product", name: "Commissions & bonuses", description: "Product-level commissions and bonuses, where applicable.", canBeNotApplicable: true },
    ],
    categoryLevels: [
      { index: 0, name: "Uncharted", minCreditedMinutes: 0 },
      { index: 1, name: "Surveyed", minCreditedMinutes: 30, requires: { summaryWritten: true } },
      { index: 2, name: "Charted", minCreditedMinutes: 120, requires: { summaryWritten: true, checklistMinItems: 3 } },
      { index: 3, name: "Fluent", minCreditedMinutes: 300, requires: { summaryWritten: true, checklistMinItems: 3, checklistComplete: true, reviewedWithinDays: 90 } },
      { index: 4, name: "Mastered", minCreditedMinutes: 540, requires: { summaryWritten: true, checklistMinItems: 3, checklistComplete: true, reviewedWithinDays: 90, explainedWithoutNotes: true, minResources: 1 } },
    ],
    objectionCases: [
      { id: "fe:objection.think-about-it", label: "I need to think about it" },
      { id: "fe:objection.too-expensive", label: "It's too expensive" },
      { id: "fe:objection.have-coverage", label: "I already have coverage" },
      { id: "fe:objection.talk-to-family", label: "I need to talk to my family first" },
      { id: "fe:objection.not-interested", label: "I'm not interested" },
      { id: "fe:objection.send-info", label: "Just send me something in the mail" },
      { id: "fe:objection.bank-info", label: "I don't give out my bank information" },
      { id: "fe:objection.call-back", label: "Call me back later" },
    ],
    scriptTemplate: {
      title: "My Final Expense script",
      sections: [
        { id: "opener", name: "Opener", body: "" },
        { id: "rapport", name: "Rapport", body: "" },
        { id: "qualifying", name: "Qualifying", body: "" },
        { id: "health", name: "Health questions", body: "" },
        { id: "presentation", name: "Presentation", body: "" },
        { id: "close", name: "Close", body: "" },
        { id: "rebuttals", name: "Rebuttals", body: "" },
      ],
    },
  },
};
