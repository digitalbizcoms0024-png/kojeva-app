// Response shapes shared by the Worker API and the React app.
import type { Fatigue } from "./fatigue.ts";
import type { AttributedTotals, HitStatus, Targets, Totals, TwTotals } from "./metrics.ts";

/** week / month = the last 7 / 30 synced days; mtd = from the 1st of the latest synced day's month. */
export type RangeKey = "week" | "month" | "mtd" | "all" | "custom";
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
  pods: { id: string; code: string; name: string; color: string; kind: "pod" | "agency" }[];
  attribution: { agencyPrefixes: string[]; podsStartDate: string | null; detected: boolean };
  editors: Editor[];
  /** Whether the signed-in viewer can make changes (Cloudflare Access is on). */
  canEdit: boolean;
  /** Who is signed in through Cloudflare Access, if anyone. */
  viewer: string | null;
  /** Posts with spend in the last 30 days that no pod or the agency is credited with. */
  needsTagging: number;
  /** Triple Whale sync state; null until the first push. */
  tripleWhale: { lastSync: string; latestDate: string; days: number; model: string } | null;
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
}

/** Claude's labels for a post's creative (from its first labelled asset); null where not labelled. */
export interface CreativeLabels {
  awareness: string | null;
  personaId: string | null;
  offer: boolean | null;
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
  /** Triple Whale results over the same days; null when none of those days is synced from Triple Whale. */
  tw: TwTotals | null;
  /** Last 3 days vs the first week; null when not spending, too new, or nothing flagged. */
  fatigue: Fatigue | null;
  /** Claude's labels; the hand-set values in `assignment` win over these. */
  labels: CreativeLabels;
}

/** How many of the period's days (with Meta data) Triple Whale has been synced for. */
export interface TwCoverage {
  days: number;
  covered: number;
  model: string | null;
}

export interface RankingsResponse {
  from: string;
  to: string;
  totals: Totals;
  tw: TwTotals | null;
  twCoverage: TwCoverage;
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
  tw: TwTotals | null;
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
  /** "late_hit" when a day-3 miss later hit target over a rolling window (see lateWindow). */
  status: HitStatus;
  /** The first rolling window that hit target, for late hits. */
  lateWindow: { from: string; to: string; totals: Totals } | null;
  /** Last day with spend. */
  lastSpend: string | null;
  /**
   * The ad that made it a hit or late hit when the concept's combined numbers didn't ("best ad
   * decides"): that ad's own judging (or late) window. Null when the concept's totals decided it.
   */
  decidedBy: { adId: string; name: string; from: string; to: string; totals: Totals; status: "hit" | "late_hit" } | null;
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
}

export interface ConceptsResponse {
  from: string;
  to: string;
  rows: ConceptResult[];
}

/** Atria dimensions are multi-valued: a concept counts under each of its themes. */
export type InsightDimension = "angle" | "format" | "awareness" | "persona" | "atria_hook" | "atria_persona" | "atria_desire" | "belief" | "atria_theme";

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
}

export interface PodsResponse {
  from: string;
  to: string;
  rows: PodRow[];
  twCoverage: TwCoverage;
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
  /** Null when no day in the bucket is synced from Triple Whale. */
  tw: TwTotals | null;
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
  tw: TwTotals | null;
  personaId: string | null;
  awareness: string | null;
  offer: boolean | null;
  hit: HitStatus | null;
}

/** One persona × awareness cell. personaId / awareness null = not placed yet. */
export interface CoverageCell {
  personaId: string | null;
  awareness: string | null;
  /** Posts running in the period (spent in it). */
  ads: number;
  totals: Totals;
  tw: TwTotals | null;
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
}
