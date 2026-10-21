// Response shapes shared by the Worker API and the React app.
import type { Fatigue } from "./fatigue.ts";
import type { AttributedTotals, HitStatus, Targets, Totals } from "./metrics.ts";

/** week / month = the last 7 / 30 synced days; mtd = from the 1st of the latest synced day's month. */
export type RangeKey = "week" | "14d" | "month" | "mtd" | "all" | "custom";
export type SortKey = "spend" | "purchases" | "roas" | "cpa" | "ctr";

export interface ConnectionStatus {
  accessProtected: boolean;
  userEmail: string | null;
  missingSecrets: string[];
  appId: string;
  adAccountId: string;
  redirectUri: string;
  systemToken: boolean;
  connection: {
    method: string;
    userName: string | null;
    expiresAt: string | null;
    connectedAt: string;
    connectedBy: string | null;
  } | null;
  maxWindowDays: number;
}

export interface Editor {
  id: string;
  name: string;
  podId: string | null;
}

/** Fields a person can set on a post. `null` clears a value; omitted fields are left alone. */
export interface AssignmentPatch {
  podId?: string | null;
  editorId?: string | null;
  angle?: string | null;
  format?: string | null;
  hook?: string | null;
  landingPage?: string | null;
  /** Awareness level (AWARENESS keys); a hand-set value wins over Claude's label. */
  awareness?: string | null;
  /** Belief group, free text up to 60 characters; a hand-set value wins over Claude's. */
  beliefGroup?: string | null;
  /** Persona id (an active persona); a hand-set value wins over Claude's. */
  personaId?: string | null;
  /** Whether the ad carries a discount or offer; a hand-set value wins over Claude's. */
  offer?: boolean | null;
  /** Motivation tags (MOTIVATIONS keys); a hand-set list wins over Claude's, null hands it back. */
  motivations?: string[] | null;
  /** Hand the pod (or tags) back to automatic attribution. */
  reset?: ("pod" | "tags")[];
}

/** A persona for the coverage map: one specific person an ad speaks to. */
export interface Persona {
  id: string;
  name: string;
  description: string;
  /** draft: Claude's first list, not confirmed yet · active: in use · suggested: Claude proposes it for ads nobody fits. */
  status: "draft" | "active" | "suggested";
}

export interface MetaResponse {
  dataMode: "sample" | "live";
  /** Days until the Meta login expires; null when not connected or it never expires. */
  connectionExpiresInDays: number | null;
  accessProtected: boolean;
  lastSync: { source: string; finishedAt: string | null; status: string; message: string | null } | null;
  latestDate: string | null;
  targets: Targets;
  /** Built-in pods, pods added in Settings (with their ad set prefix and color slot), then the agency. */
  pods: { id: string; code: string; name: string; color: string; kind: "pod" | "agency"; prefix: string | null; slot: number | null }[];
  attribution: { agencyPrefixes: string[]; podsStartDate: string | null; detected: boolean };
  editors: Editor[];
  /** Whether the signed-in viewer can make changes: Access is on and they're on the edit list (or it's empty). */
  canEdit: boolean;
  /** The media buyer: the only person who can make winner calls (MEDIA_BUYER_EMAILS). */
  isMediaBuyer: boolean;
  /** Emails that can edit (sent to editors only; empty for view-only people). Empty for an editor = everyone signed in can. */
  editAccess: string[];
  /** Who is signed in through Cloudflare Access, if anyone. */
  viewer: string | null;
  /** Posts with spend in the last 30 days that no pod or the agency is credited with. */
  needsTagging: number;
  /** Personas in display order (drafts, active and Claude's suggestions; dismissed ones left out). */
  personas: Persona[];
}

export interface Assignment {
  podId: string | null;
  podSource: string | null;
  editorId: string | null;
  editorName: string | null;
  angle: string | null;
  format: string | null;
  hook: string | null;
  landingPage: string | null;
  tagsSource: string | null;
  /** Hand-set awareness, belief group, persona and offer; null means use Claude's labels. */
  awareness: string | null;
  beliefGroup: string | null;
  personaId: string | null;
  offer: boolean | null;
  motivations: string[] | null;
}

/** Claude's labels for a post's creative (from its first labelled asset); null where not labelled. */
export interface CreativeLabels {
  awareness: string | null;
  personaId: string | null;
  offer: boolean | null;
  motivations: string[] | null;
  /** Claude's suggested format (FORMATS key): a suggestion only, never applied without someone accepting it. */
  format: string | null;
}

export interface PostSummary {
  postId: string;
  name: string;
  /** Ad set of the post's first ad (where it was tested). */
  adsetName: string | null;
  mediaType: string;
  thumbnailUrl: string | null;
  launched: string | null;
  firstSpend: string | null;
  daysLive: number | null;
  copies: number;
  active: boolean;
  assignment: Assignment;
  totals: Totals;
  hit: HitStatus | null;
  /** Atria's tags for the post's creative, by category (theme, core_desire, …); null if untagged. */
  atria: Record<string, string[]> | null;
  /** Last 3 days vs the first week; null when not spending, too new, or nothing flagged. */
  fatigue: Fatigue | null;
  /** Claude's labels; the hand-set values in `assignment` win over these. */
  labels: CreativeLabels;
  /** The concept (testing ad set) the post was tested in; null for scaling-only or agency posts. */
  conceptId: string | null;
}

export interface RankingsResponse {
  from: string;
  to: string;
  totals: Totals;
  count: number;
  items: PostSummary[];
}

export interface CopyRow {
  adId: string;
  name: string;
  campaignName: string | null;
  adsetName: string | null;
  status: string;
  totals: Totals;
}

export interface PostDetail extends PostSummary {
  allTime: Totals;
  copyRows: CopyRow[];
  daily: ({ date: string } & Totals)[];
}

export interface PodRow {
  podId: string | null;
  kind: "pod" | "agency" | "unassigned";
  name: string;
  color: string | null;
  totals: Totals;
  concepts: number;
  /** Hits including late hits. */
  hits: number;
  lateHits: number;
  misses: number;
  testing: number;
  hitRate: number | null;
  editors: { editorId: string | null; name: string; totals: Totals; concepts: number }[];
  /** Daily spend in cents for the last 7 synced days, oldest first (0 on days without spend). */
  spark: number[];
}

export interface ConceptResult {
  conceptId: string;
  podId: string;
  label: string;
  adsetName: string;
  ads: number;
  firstSpend: string;
  /** First day any single ad in the concept had spent the minimum; null if none has. */
  qualifiedOn: string | null;
  /** Last day of the judging window: day N, or qualifiedOn if later. */
  windowEnd: string;
  /** Concept totals from first spend to windowEnd. */
  window: Totals;
  allTime: Totals;
  /** "late_hit" when a day-3 miss later hit target over a rolling window (see lateWindow); "winner" / "super_winner" when the media buyer called it (see call). */
  status: HitStatus;
  /** The media buyer's winner call on a miss, if any. */
  call: ConceptCall | null;
  /** A miss close enough to target, on enough spend, to be worth a call (winnerCandidate); null once called. */
  candidate: "winner" | "super_winner" | null;
  /** The first rolling window that hit target, for late hits. */
  lateWindow: { from: string; to: string; totals: Totals } | null;
  /** Last day with spend. */
  lastSpend: string | null;
  /** Spent in the last 3 synced days. */
  stillRunning: boolean;
  angle: string | null;
  format: string | null;
  /** "manual" when someone tagged one of its ads by hand, else read from names. */
  tagsSource: "manual" | "name";
  /** Union of Atria themes / core desires across the concept's ads; empty if none tagged. */
  atriaThemes: string[];
  atriaDesires: string[];
  /** Atria visual hooks and personas (avatars) across the concept's assets. */
  atriaHooks: string[];
  atriaPersonas: string[];
  /** Awareness level (AWARENESS keys): hand-set, else the most common label Claude gave its assets. */
  awareness: string | null;
  awarenessSource: "manual" | "claude" | null;
  /** Belief groups it shifts (hand-set one wins), and up to 3 of Claude's belief wordings. */
  beliefGroups: string[];
  beliefs: string[];
  /** Persona: hand-set on one of its ads, else the most common one Claude gave its assets. */
  personaId: string | null;
  /** Motivation tags across its ads (hand-set lists win per ad over Claude's). */
  motivations: string[];
}

export interface ConceptsResponse {
  from: string;
  to: string;
  rows: ConceptResult[];
}

/** One ad in a concept, for the concept card. */
export interface ConceptAdRow {
  adId: string;
  postId: string;
  name: string;
  status: string;
  campaignName: string | null;
  mediaType: string;
  thumbnailUrl: string | null;
  /** Over the concept's judging window, and since launch. */
  window: Totals;
  allTime: Totals;
}

/** GET /api/concepts/:id: the concept card. */
export interface ConceptDetail {
  concept: ConceptResult;
  /** Biggest all-time spend first. */
  ads: ConceptAdRow[];
  /** Concept totals per day with any spend or purchases, oldest first. */
  daily: ({ date: string } & Totals)[];
}

/** Atria dimensions are multi-valued: a concept counts under each of its themes. */
export type InsightDimension = "angle" | "format" | "awareness" | "persona" | "motivation" | "atria_hook" | "atria_persona" | "atria_desire" | "belief" | "atria_theme";

export interface InsightRow {
  /** Tag key, or null for concepts with no tag on this dimension. */
  value: string | null;
  concepts: number;
  /** Hits including late hits. */
  hits: number;
  lateHits: number;
  misses: number;
  testing: number;
  hitRate: number | null;
  /** Summed judging-window totals of the concepts. */
  window: Totals;
  /** Pods contributing concepts, with counts. */
  pods: { podId: string; concepts: number }[];
}

export interface InsightsResponse {
  from: string;
  to: string;
  dimension: InsightDimension;
  rows: InsightRow[];
  /** Every concept in the period (and pod): the average a row is read against. */
  baseline: HitBaseline;
}

export interface HitBaseline {
  concepts: number;
  hits: number;
  decided: number;
  hitRate: number | null;
  window: Totals;
}

/** A tag value worth a look, from one dimension. */
export interface InsightPick {
  dimension: InsightDimension;
  row: InsightRow & { value: string };
}

/** The top of Creative Insights: what to make more of, and where test money found nothing. */
export interface InsightsOverview {
  from: string;
  to: string;
  baseline: HitBaseline;
  /** The best value per dimension (enough decided tests, beats the average), best first. */
  winners: InsightPick[];
  /** Values with enough decided tests and no hit, most test spend first. */
  sinks: InsightPick[];
  /** Concepts missing an angle / a format. */
  untagged: { dimension: InsightDimension; concepts: number }[];
}

/** Dimensions the matrix can cross. */
export type MatrixDimension = "angle" | "format" | "awareness" | "persona" | "motivation";

export interface InsightsMatrix {
  from: string;
  to: string;
  rows: MatrixDimension;
  cols: MatrixDimension;
  /** Tagged values on each axis, most concepts first. Untagged concepts are left out (see `skipped`). */
  rowValues: string[];
  colValues: string[];
  cells: (InsightRow & { row: string; col: string })[];
  baseline: HitBaseline;
  skipped: number;
}

export interface PodsResponse {
  from: string;
  to: string;
  rows: PodRow[];
}

/** Something on the dashboard worth a look. Tone follows the status colors (always shown with an icon). */
export interface Alert {
  id: string;
  tone: "bad" | "warn" | "good";
  title: string;
  detail: string;
  /** In-app link, e.g. "#/rankings?post=…" or "#/tagging". */
  href: string;
  action: string;
}

export interface AlertsResponse {
  asOf: string | null;
  alerts: Alert[];
}

/** A likely pod for an ad nobody is credited with, for a person to accept or ignore. */
export interface PodSuggestion {
  podId: string;
  confidence: "high" | "medium";
  reason: string;
}

export interface SuggestionsResponse {
  /** Keyed by post ID; posts without a suggestion are left out. */
  suggestions: Record<string, PodSuggestion>;
}

export type TrendGrain = "day" | "week";

export interface TrendPoint {
  /** First day of the bucket (weeks start on Monday). */
  start: string;
  totals: Totals;
}

export interface TrendsResponse {
  from: string;
  to: string;
  grain: TrendGrain;
  pod: string | null;
  points: TrendPoint[];
}

/** New concepts per pod per calendar week (Monday–Sunday), by first day of spend. */
export interface LaunchesResponse {
  /** Monday of each week, oldest first; the last one is the current week (the week of the latest synced day). */
  weeks: string[];
  rows: { podId: string; name: string; kind: "pod" | "agency"; counts: number[] }[];
}

export type AttributionLevel = "pod" | "concept" | "post";

/** One row of the attribution comparison: same Meta spend, three ways of counting purchases. */
export interface AttributionRow {
  key: string;
  label: string;
  podId: string | null;
  spendCents: number;
  /** The ad set's own setting (what the rest of the hub shows). */
  standard: AttributedTotals;
  /** Null when no day in the period has 7-day-click data. */
  click7: AttributedTotals | null;
  /** Null when no day in the period has incremental data. */
  incremental: AttributedTotals | null;
  /** Spend on days that have incremental data (the share of spend the comparison covers). */
  coveredSpendCents: number;
}

export interface AttributionResponse {
  from: string;
  to: string;
  level: AttributionLevel;
  total: AttributionRow;
  rows: AttributionRow[];
}

/** A post on the coverage map, with its effective persona, awareness and offer (hand-set wins over Claude). */
export interface CoveragePost {
  postId: string;
  name: string;
  thumbnailUrl: string | null;
  mediaType: string;
  podId: string | null;
  totals: Totals;
  personaId: string | null;
  awareness: string | null;
  offer: boolean | null;
  hit: HitStatus | null;
  /** Why it's off the map (null when placed): Claude hasn't labelled it yet, or it fits no persona. */
  why: UnplacedReason | null;
}

export type UnplacedReason = "waiting" | "none";

/** One persona × awareness cell. personaId / awareness null = not placed yet. */
export interface CoverageCell {
  personaId: string | null;
  awareness: string | null;
  /** Posts running in the period (spent in it). */
  ads: number;
  totals: Totals;
  /** Spend on ads labelled with a discount/offer, and on ads whose offer label is known. */
  offerSpendCents: number;
  offerKnownSpendCents: number;
  /** All-time concept track record in this cell (not limited to the period). */
  concepts: number;
  hits: number;
  misses: number;
  testing: number;
  hitRate: number | null;
}

export interface CoverageResponse {
  from: string;
  to: string;
  /** Active personas, in order. Empty until the list is confirmed in Settings. */
  personas: Persona[];
  totals: Totals;
  /** Every cell with running ads or a concept history (empty ones are left out). */
  cells: CoverageCell[];
  posts: CoveragePost[];
  /** Persona × awareness cells on the grid, and how many have running ads. */
  defined: number;
  filled: number;
  /** The placed cell with the most spend, with its share of all spend and its offer share. */
  top: { personaId: string; awareness: string; share: number; offerShare: number | null } | null;
  /** Running posts missing a persona or an awareness level. */
  unplaced: number;
  /** The unplaced ones by reason (see CoveragePost.why). */
  unplacedWhy: Record<UnplacedReason, number>;
}

/** Totals for one stretch of days in a winner call's evidence. */
export interface EvidenceWindow {
  from: string;
  to: string;
  days: number;
  /** Every ad in the account (Meta). */
  account: Totals;
  /** The account without this concept's ads: did the rest improve? */
  rest: Totals;
  /** Product- and most-aware ads (MOF/BOF by awareness label), without this concept. */
  mofBof: Totals;
  /** This concept. */
  concept: Totals;
}

/** What a winner call rests on: the account before the concept launched and since. */
export interface CallEvidence {
  conceptId: string;
  before: EvidenceWindow;
  since: EvidenceWindow;
  /** The concept's share of all testing spend and purchases since it launched (0–1). */
  shareOfTestSpend: number | null;
  shareOfTestPurchases: number | null;
  /** Meta's incremental attribution for the concept since launch; null if not synced. */
  incremental: { spendCents: number; purchases: number; revenueCents: number } | null;
  computedAt: string;
}

export interface ConceptCall {
  kind: "winner" | "super_winner";
  reason: string;
  calledBy: string;
  calledAt: string;
  evidence: CallEvidence;
}

/** Totals with the ratios people read (CS report). */
export type ReportFigures = Totals & { cpa: number | null; roas: number | null; cpm: number | null };

/** One pod concept in a CS report. */
export interface ReportConcept {
  conceptId: string;
  podId: string;
  label: string;
  adsetName: string;
  status: HitStatus;
  call: ConceptCall | null;
  candidate: "winner" | "super_winner" | null;
  firstSpend: string;
  windowEnd: string;
  lastSpend: string | null;
  stillRunning: boolean;
  tags: {
    angle: string | null;
    format: string | null;
    awareness: string | null;
    persona: string | null;
    motivations: string[];
    beliefGroups: string[];
    atriaThemes: string[];
    atriaHooks: string[];
  };
  window: ReportFigures;
  lateWindow: ({ from: string; to: string } & ReportFigures) | null;
  /** Spend in the report's period only. */
  period: ReportFigures;
  allTime: ReportFigures;
  daily: ({ date: string } & ReportFigures)[];
  ads: { name: string; status: string; period: ReportFigures; allTime: ReportFigures }[];
}

/** An earlier period's concept whose result came in during this period (CS report → Late verdicts). */
export interface LateVerdict {
  conceptId: string;
  podId: string;
  label: string;
  format: string | null;
  status: HitStatus;
  firstSpend: string;
  /** When the result came in: window closed, late-hit window ended, or the winner call. */
  verdictOn: string;
  window: ReportFigures;
  lateWindow: ({ from: string; to: string } & ReportFigures) | null;
  allTime: ReportFigures;
}

/** Everything a CS report is written from (GET /api/reports/:from, /api/ingest/report). */
export interface ReportData {
  from: string;
  to: string;
  /** Report number (1 = Sep 18 – Oct 4, 2026), when the range is a report period. */
  n: number | null;
  targets: Targets;
  pods: { podId: string; name: string; testingSpendCents: number }[];
  concepts: ReportConcept[];
  lateVerdicts: LateVerdict[];
  /** The previous period's concepts' results as they stand now (its hit rate, updated). */
  previous: { n: number; from: string; to: string; concepts: { podId: string; label: string; status: HitStatus }[] } | null;
}

/** The written part of a report: Claude's draft, or the team's edit of it. */
export interface ReportText {
  learnings: string;
  read: string;
  /** "claude" until someone edits it in the hub. */
  source: "claude" | "edited";
  updatedBy: string | null;
  updatedAt: string;
}

export interface ReportResponse {
  data: ReportData;
  text: ReportText | null;
}

export interface ReportsListResponse {
  periods: { n: number; from: string; to: string; closed: boolean; text: ReportText["source"] | null }[];
}
