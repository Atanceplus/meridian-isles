import type { ContentPackInput } from "../schema";

/**
 * Core pack: the five composite skills, product-line-neutral training
 * activities, their gate achievements, and the islands that are not tied to
 * a specific product line. Calibration values are the v0.2 design defaults
 * (docs/DESIGN.md §3) and can be overridden per instance.
 */

const S = {
  tonality: "core:skill.tonality",
  productKnowledge: "core:skill.product-knowledge",
  objections: "core:skill.objection-handling",
  smallTalk: "core:skill.small-talk",
  speed: "core:skill.speed",
} as const;
export const CORE_SKILLS = S;

const THRESHOLDS = [0, 1000, 3000, 6000, 10000] as const;
const ACTIVE_WEEK = { minDays: 3, minMinutes: 60, minActivityTypes: 2 };
const BREADTH = { minTypes: 3, minShareEach: 0.1, maxShareSingle: 0.6 };

interface GateTiming {
  r3: [days: number, weeks: number];
  r4: [days: number, weeks: number];
  r5: [days: number, weeks: number];
}

/** One-year skills (Speed, Product Knowledge) and shorter ones share this ladder shape. */
function ranks(names: [string, string, string, string, string], gateAchievements: (string | null)[], t: GateTiming) {
  const ach = (i: number) => {
    const id = gateAchievements[i];
    return id ? [id] : [];
  };
  return [
    { name: names[0], threshold: THRESHOLDS[0] },
    { name: names[1], threshold: THRESHOLDS[1], gate: { achievementIds: ach(0) } },
    {
      name: names[2],
      threshold: THRESHOLDS[2],
      gate: { achievementIds: ach(1), minElapsedDays: t.r3[0], minActiveWeeks: t.r3[1] },
    },
    {
      name: names[3],
      threshold: THRESHOLDS[3],
      gate: { achievementIds: ach(2), minElapsedDays: t.r4[0], minActiveWeeks: t.r4[1], breadth: BREADTH },
    },
    {
      name: names[4],
      threshold: THRESHOLDS[4],
      gate: { achievementIds: ach(3), minElapsedDays: t.r5[0], minActiveWeeks: t.r5[1], breadth: BREADTH },
    },
  ];
}

const ONE_YEAR: GateTiming = { r3: [60, 8], r4: [180, 22], r5: [365, 44] };
const EIGHT_MONTHS: GateTiming = { r3: [45, 6], r4: [120, 14], r5: [240, 30] };
const FIVE_MONTHS: GateTiming = { r3: [30, 4], r4: [75, 10], r5: [150, 18] };

const weekly = (w: number) => ({ fullUpTo: w, reducedUpTo: w * 1.5, reducedRate: 0.5 });
const tier = (fullUpTo: number, reducedUpTo: number) => ({ fullUpTo, reducedUpTo, reducedRate: 0.5 });

const minutesField = { key: "minutes", label: "Minutes", kind: "number", required: true, min: 1 } as const;
const reflectionField = { key: "reflection", label: "Reflection", kind: "longtext", required: false } as const;
const ratingField = (key: string, label: string) => ({ key, label, kind: "rating", min: 1, max: 5 }) as const;

export const corePack: ContentPackInput = {
  format: "meridian-pack",
  id: "core",
  name: "Core skills and training",
  version: "0.1.0",

  skills: [
    {
      id: S.tonality,
      name: "Tonality",
      description: "Tone, pacing, warmth and certainty in your delivery.",
      maxScore: 10000,
      weeklyLimit: weekly(300),
      activeWeek: ACTIVE_WEEK,
      ranks: ranks(
        ["Static", "Signal", "Clear Channel", "Prime Time", "Golden Frequency"],
        ["core:ach.tonality.first-signal", "core:ach.tonality.tuned-in", "core:ach.tonality.prime-time", "core:ach.tonality.golden-frequency"],
        EIGHT_MONTHS,
      ),
    },
    {
      id: S.productKnowledge,
      name: "Product Knowledge",
      description: "Carriers, products, underwriting and application know-how.",
      maxScore: 10000,
      weeklyLimit: weekly(250),
      activeWeek: ACTIVE_WEEK,
      // Gate achievements come from product-line packs via gatePatches.
      ranks: ranks(["Castaway", "Deckhand", "Navigator", "Cartographer", "Admiral"], [], ONE_YEAR),
    },
    {
      id: S.objections,
      name: "Objection Handling",
      description: "Hearing, answering and resolving objections.",
      maxScore: 10000,
      weeklyLimit: weekly(300),
      activeWeek: ACTIVE_WEEK,
      ranks: ranks(
        ["Defendant", "Paralegal", "Counsel", "Barrister", "Chief Justice"],
        ["core:ach.objections.docket-opened", "core:ach.objections.counsel-sworn", "core:ach.objections.barrister", "core:ach.objections.chief-justice"],
        EIGHT_MONTHS,
      ),
    },
    {
      id: S.smallTalk,
      name: "Small Talk",
      description: "Rapport, stories and smooth transitions back to business.",
      maxScore: 10000,
      weeklyLimit: weekly(400),
      activeWeek: ACTIVE_WEEK,
      ranks: ranks(
        ["Wallflower", "Friendly Face", "Storyteller", "Confidant", "Hearthkeeper"],
        ["core:ach.small-talk.open-door", "core:ach.small-talk.storyteller", "core:ach.small-talk.confidant", "core:ach.small-talk.hearthkeeper"],
        FIVE_MONTHS,
      ),
    },
    {
      id: S.speed,
      name: "Speed",
      description: "Fluency and efficient execution, from script to submitted application.",
      maxScore: 10000,
      weeklyLimit: weekly(250),
      activeWeek: ACTIVE_WEEK,
      ranks: ranks(
        ["Snail", "Jackrabbit", "Cheetah", "Bullet Train", "Lightspeed"],
        ["core:ach.speed.off-the-line", "core:ach.speed.pit-crew", "core:ach.speed.express-service", "core:ach.speed.lightspeed"],
        ONE_YEAR,
      ),
    },
  ],

  islands: [
    { id: "core:island.hq", name: "Headquarters", tagline: "Home, and the record of everything you've built.", restorationSource: "hq" },
    { id: "core:island.script-foundry", name: "Script Foundry", tagline: "Forge the script; rehearse it until it rings.", skillIds: [S.speed, S.tonality], restorationSource: "scriptTracks" },
    { id: "core:island.court-of-objections", name: "Court of Objections", tagline: "Every objection gets its day in court.", skillIds: [S.objections], restorationSource: "skill" },
    { id: "core:island.last-broadcast", name: "Last Broadcast", tagline: "Bring the signal back to the wasteland.", skillIds: [S.tonality], restorationSource: "skill" },
    { id: "core:island.conversation-cove", name: "Conversation Cove", tagline: "Lanterns, docks and good company.", skillIds: [S.smallTalk], restorationSource: "skill" },
    { id: "core:island.velocity-circuit", name: "Velocity Circuit", tagline: "Shave the seconds. Keep it clean.", skillIds: [S.speed], restorationSource: "skill" },
  ],

  activityTypes: [
    {
      id: "core:act.call-report",
      name: "Daily call report",
      islandId: "core:island.hq",
      description: "Hours on the phone. Real calls train several skills at once.",
      measure: "hours",
      xpPerUnit: 12,
      skillWeights: { [S.speed]: 40, [S.tonality]: 20, [S.objections]: 20, [S.smallTalk]: 20 },
      limits: { daily: tier(6, 8) },
      unitsField: "hours",
      quickLog: false,
      fields: [
        { key: "calls", label: "Calls", kind: "number", required: true, min: 0 },
        { key: "hours", label: "Hours worked", kind: "number", required: true, min: 0 },
        { key: "applicationsSubmitted", label: "Sales (applications submitted)", kind: "number", required: true, min: 0 },
        { key: "issuePaid", label: "Issue Paid (IP), as reported", kind: "number", min: 0 },
      ],
    },
    {
      id: "core:act.script-rehearsal",
      name: "Script rehearsal",
      islandId: "core:island.script-foundry",
      description: "Rehearse one or more script sections.",
      measure: "minutes",
      xpPerUnit: 3,
      skillWeights: { [S.speed]: 50, [S.tonality]: 50 },
      modes: {
        silent: { label: "Silent read", multiplier: 0.75 },
        aloud: { label: "Read aloud", multiplier: 1 },
        memorized: { label: "From memory", multiplier: 1 },
        recorded: { label: "Recorded + self-review", multiplier: 1.25 },
      },
      limits: { daily: tier(45, 90) },
      subjectKind: "scriptSection",
      unitsField: "minutes",
      fields: [
        minutesField,
        { key: "sections", label: "Sections", kind: "multiselect", required: true, source: "scriptSections" },
        { key: "reps", label: "Run-throughs", kind: "number", min: 0 },
        ratingField("pace", "Pace"),
        ratingField("clarity", "Clarity"),
        ratingField("warmth", "Warmth"),
      ],
    },
    {
      id: "core:act.script-revision",
      name: "Meaningful script revision",
      islandId: "core:island.script-foundry",
      description: "A revision you explicitly mark as a meaningful improvement, with a change note.",
      measure: "count",
      xpPerUnit: 25,
      skillWeights: { [S.speed]: 50, [S.tonality]: 50 },
      limits: { daily: tier(2, 2), weekly: tier(4, 4) },
      minutesPerUnit: 15,
      requiresReflection: true,
      quickLog: false,
      fields: [
        { key: "tag", label: "Improvement type", kind: "select", required: true, options: ["clarity", "compliance", "tonality cue", "objection prevention", "flow", "brevity"] },
        { key: "note", label: "What changed and why", kind: "longtext", required: true, minLength: 40 },
      ],
    },
    {
      id: "core:act.tonality-drill",
      name: "Tonality drill",
      islandId: "core:island.last-broadcast",
      description: "Focused delivery practice.",
      measure: "minutes",
      xpPerUnit: 3,
      skillWeights: { [S.tonality]: 100 },
      limits: { daily: tier(40, 80) },
      unitsField: "minutes",
      fields: [
        minutesField,
        { key: "drillType", label: "Drill", kind: "select", required: true, options: ["pace", "pitch variation", "pausing", "warmth", "certainty", "downtone close", "mirroring"] },
        ratingField("selfRating", "Self-rating"),
      ],
    },
    {
      id: "core:act.listen-skilled",
      name: "Listen to skilled speakers",
      islandId: "core:island.last-broadcast",
      description: "Study how strong speakers sound.",
      measure: "minutes",
      xpPerUnit: 1.5,
      skillWeights: { [S.tonality]: 60, [S.smallTalk]: 20, [S.objections]: 20 },
      limits: { daily: tier(45, 90) },
      unitsField: "minutes",
      fields: [
        minutesField,
        { key: "source", label: "Source", kind: "text", required: true },
        { key: "takeaways", label: "Three takeaways", kind: "longtext", required: true },
      ],
    },
    {
      id: "core:act.objection-listen",
      name: "Listen to objection handling",
      islandId: "core:island.court-of-objections",
      description: "Hear how others handle objections.",
      measure: "minutes",
      xpPerUnit: 1.5,
      skillWeights: { [S.objections]: 100 },
      limits: { daily: tier(45, 90) },
      unitsField: "minutes",
      fields: [minutesField, { key: "source", label: "Source", kind: "text", required: true }, { key: "takeaways", label: "Takeaways", kind: "longtext", required: true }],
    },
    {
      id: "core:act.objection-practice",
      name: "Objection response practice",
      islandId: "core:island.court-of-objections",
      description: "Practice responses to cases on your docket.",
      measure: "reps",
      xpPerUnit: 4,
      skillWeights: { [S.objections]: 80, [S.tonality]: 20 },
      modes: {
        written: { label: "Written", multiplier: 1 },
        spoken: { label: "Spoken", multiplier: 1 },
        recorded: { label: "Recorded", multiplier: 1 },
        roleplay: { label: "Role-play partner", multiplier: 1 },
      },
      limits: { daily: tier(60, 100), dailyPerSubject: tier(10, 10) },
      subjectKind: "objectionCase",
      minutesPerUnit: 1,
      unitsField: "reps",
      subjectFields: ["caseId"],
      fields: [
        { key: "caseId", label: "Docket case", kind: "select", required: true, source: "objectionCases" },
        { key: "reps", label: "Reps", kind: "number", required: true, min: 1 },
        ratingField("fluency", "Fluency"),
      ],
    },
    {
      id: "core:act.call-review",
      name: "Review one of your calls",
      islandId: "core:island.last-broadcast",
      description: "Listen back to your own call with a rubric and a reflection.",
      measure: "minutes",
      xpPerUnit: 3,
      skillWeights: { [S.tonality]: 30, [S.objections]: 30, [S.smallTalk]: 20, [S.speed]: 20 },
      limits: { daily: tier(45, 90) },
      requiresReflection: true,
      unitsField: "minutes",
      fields: [
        minutesField,
        ratingField("tonality", "Tonality"),
        ratingField("pacing", "Pacing"),
        ratingField("rapport", "Rapport"),
        ratingField("objections", "Objection handling"),
        ratingField("control", "Call control"),
        ratingField("transition", "Transition back to business"),
        { ...reflectionField, required: true },
      ],
    },
    {
      id: "core:act.small-talk-practice",
      name: "Small talk & transition practice",
      islandId: "core:island.conversation-cove",
      description: "Practice rapport scenarios and transitions back to business.",
      measure: "minutes",
      xpPerUnit: 3,
      skillWeights: { [S.smallTalk]: 80, [S.tonality]: 20 },
      limits: { daily: tier(30, 60) },
      subjectKind: "rapportScenario",
      unitsField: "minutes",
      fields: [
        minutesField,
        { key: "scenarioId", label: "Scenario", kind: "select", required: true, source: "rapportScenarios" },
        { key: "transition", label: "Transition practiced", kind: "text" },
        { key: "reps", label: "Reps", kind: "number", min: 0 },
        reflectionField,
      ],
    },
    {
      id: "core:act.time-trial",
      name: "Time trial",
      islandId: "core:island.velocity-circuit",
      description: "A timed run on a course, e.g. a full script run-through.",
      measure: "runs",
      xpPerUnit: 15,
      personalBestBonus: 10,
      skillWeights: { [S.speed]: 100 },
      modes: {
        general: { label: "General course", multiplier: 1 },
        script: { label: "Script run-through", multiplier: 1, skillWeights: { [S.speed]: 70, [S.tonality]: 30 } },
      },
      limits: { daily: tier(5, 8) },
      subjectKind: "course",
      minutesPerUnit: 10,
      subjectFields: ["courseId"],
      timeField: "durationSeconds",
      cleanField: "clean",
      fields: [
        { key: "courseId", label: "Course", kind: "select", required: true, source: "courses" },
        { key: "durationSeconds", label: "Time (seconds)", kind: "number", required: true, min: 1 },
        { key: "clean", label: "Completed cleanly", kind: "boolean", required: true },
      ],
    },
  ],

  achievements: [
    // Tonality
    { id: "core:ach.tonality.first-signal", name: "First Signal", skillId: S.tonality, rank: 2, kind: "count", description: "Hear yourself for the first time.", requirements: ["3 recorded rehearsals self-reviewed with the rubric"] },
    { id: "core:ach.tonality.tuned-in", name: "Tuned In", skillId: S.tonality, rank: 3, kind: "composite", description: "Range across drills and a clean full read.", requirements: ["20 tonality drills across at least 4 drill types", "A recorded full-script read rated 3/5 or better on every rubric item"] },
    { id: "core:ach.tonality.prime-time", name: "Prime Time", skillId: S.tonality, rank: 4, kind: "count", description: "Consistent review of your real calls.", requirements: ["10 call reviews with tonality notes across at least 6 different weeks"] },
    { id: "core:ach.tonality.golden-frequency", name: "Golden Frequency", skillId: S.tonality, rank: 5, kind: "rubric", description: "Mastery heard on real calls.", requirements: ["3 real calls in 3 different weeks self-scored 4/5 or better on every tonality rubric item"] },
    // Objection handling
    { id: "core:ach.objections.docket-opened", name: "Docket Opened", skillId: S.objections, rank: 2, kind: "count", description: "Your objection library exists.", requirements: ["At least 10 docket cases, each with a written response"] },
    { id: "core:ach.objections.counsel-sworn", name: "Counsel Sworn", skillId: S.objections, rank: 3, kind: "count", description: "Every case rehearsed out loud.", requirements: ["Every docket case practiced with at least 10 spoken reps"] },
    { id: "core:ach.objections.barrister", name: "Barrister", skillId: S.objections, rank: 4, kind: "count", description: "Objections met in the real world.", requirements: ["25 real objections logged across at least 8 case types"] },
    { id: "core:ach.objections.chief-justice", name: "Chief Justice", skillId: S.objections, rank: 5, kind: "rubric", description: "Randomized trials, passed under pressure.", requirements: ["3 Rebuttal Trials (15 random cases each) on separate weeks, self-rated 90% fluent or better"] },
    // Small talk
    { id: "core:ach.small-talk.open-door", name: "Open Door", skillId: S.smallTalk, rank: 2, kind: "count", description: "A library of ways in.", requirements: ["A Rapport Library with at least 15 cards"] },
    { id: "core:ach.small-talk.storyteller", name: "Storyteller", skillId: S.smallTalk, rank: 3, kind: "count", description: "Practice across many kinds of people.", requirements: ["50 practice reps across at least 5 scenarios"] },
    { id: "core:ach.small-talk.confidant", name: "Confidant", skillId: S.smallTalk, rank: 4, kind: "count", description: "Rapport noticed on real calls.", requirements: ["20 real-call rapport notes"] },
    { id: "core:ach.small-talk.hearthkeeper", name: "Hearthkeeper", skillId: S.smallTalk, rank: 5, kind: "rubric", description: "Warmth that still gets to business.", requirements: ["5 call reviews self-scored 4/5 or better on rapport and on transition back to business"] },
    // Speed
    { id: "core:ach.speed.off-the-line", name: "Off the Line", skillId: S.speed, rank: 2, kind: "checklist", description: "A clean full-script run under your target.", requirements: ["Set a target time for a full script run (frozen once set)", "Complete a timed full run under that target without skipping sections"] },
    { id: "core:ach.speed.pit-crew", name: "Pit Crew", skillId: S.speed, rank: 3, kind: "count", description: "Fast, accurate application navigation.", requirements: ["Application navigation under your target time on 3 different carriers"] },
    { id: "core:ach.speed.express-service", name: "Express Service", skillId: S.speed, rank: 4, kind: "count", description: "Momentum on live calls.", requirements: ["5 real sales (applications submitted) within one continuous 60-minute window"] },
    {
      id: "core:ach.speed.lightspeed",
      name: "Lightspeed",
      skillId: S.speed,
      rank: 5,
      kind: "lightspeed",
      description: "Ten sales in thirty minutes, and every one of them sticks.",
      requirements: [
        "10 real sales (applications submitted) within one continuous 30-minute window",
        "Every resulting policy passes 3 calendar months without a chargeback, confirmed by you at each checkpoint",
        "Speed score at its maximum",
        "The sustained-effort gate: 365 days elapsed and 44 active weeks",
      ],
    },
  ],

  seeds: {
    // Kinds of purchase, not vendors or products: you name what you actually bought.
    catalog: [
      { id: "core:catalog.leads", category: "leads", name: "Lead package", description: "A batch of leads you bought.", capabilities: "Lead type, source, age, exclusivity", tracksInventory: true },
      { id: "core:catalog.crm", category: "crm", name: "CRM", description: "Customer relationship management software.", capabilities: "Pipelines, notes, reminders, reporting", subscription: true },
      { id: "core:catalog.dialer", category: "dialer", name: "Dialer", description: "Calling software or service.", capabilities: "Dialing mode, lines, call recording", subscription: true },
      { id: "core:catalog.training", category: "training", name: "Training or coaching", description: "A course, book, program or coach.", capabilities: "Topics covered, format, length" },
      { id: "core:catalog.equipment", category: "equipment", name: "Equipment", description: "Headset, computer, monitor or other gear.", capabilities: "What it does for your calls or workflow" },
      { id: "core:catalog.service", category: "service", name: "Business service", description: "A service your business pays for, such as a website or answering service.", capabilities: "What the service covers", subscription: true },
    ],
    scriptTracks: {
      craft: [
        { name: "Unforged", min: 0 },
        { name: "Tinker", min: 1 },
        { name: "Smith", min: 3 },
        { name: "Artisan", min: 8 },
        { name: "Master Smith", min: 15 },
        { name: "Forgemaster", min: 25 },
      ],
      rehearsal: [
        { name: "Silent", min: 0 },
        { name: "Reader", min: 60 },
        { name: "Reciter", min: 300 },
        { name: "Performer", min: 900 },
        { name: "Orator", min: 1800 },
        { name: "Virtuoso", min: 3600 },
      ],
    },
    rapportScenarios: [
      { id: "core:scenario.grieving", label: "Recently bereaved" },
      { id: "core:scenario.skeptical", label: "Skeptical caller" },
      { id: "core:scenario.chatty", label: "Chatty retiree" },
      { id: "core:scenario.rushed", label: "Rushed caller" },
      { id: "core:scenario.veteran", label: "Veteran" },
      { id: "core:scenario.caregiver", label: "Family caregiver" },
    ],
  },
};
