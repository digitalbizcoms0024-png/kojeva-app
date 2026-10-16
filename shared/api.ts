// Response shapes shared by the Worker API and the React app.
import type { HitStatus, Targets, Totals, TwTotals } from "./metrics.ts";

export type RangeKey = "week" | "month" | "all" | "custom";
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
  /** Hand the pod (or tags) back to automatic attribution. */
  reset?: ("pod" | "tags")[];
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
  hits: number;
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
  status: HitStatus;
  angle: string | null;
  format: string | null;
  /** "manual" when someone tagged one of its ads by hand, else read from names. */
  tagsSource: "manual" | "name";
  /** Union of Atria themes / core desires across the concept's ads; empty if none tagged. */
  atriaThemes: string[];
  atriaDesires: string[];
}

export interface ConceptsResponse {
  from: string;
  to: string;
  rows: ConceptResult[];
}

/** Atria dimensions are multi-valued: a concept counts under each of its themes. */
export type InsightDimension = "angle" | "format" | "atria_theme" | "atria_desire";

export interface InsightRow {
  /** Tag key, or null for concepts with no tag on this dimension. */
  value: string | null;
  concepts: number;
  hits: number;
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
