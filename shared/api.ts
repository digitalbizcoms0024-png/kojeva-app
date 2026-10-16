// Response shapes shared by the Worker API and the React app.
import type { HitStatus, Targets, Totals } from "./metrics.ts";

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

export interface MetaResponse {
  dataMode: "sample" | "live";
  /** Days until the Meta login expires; null when not connected or it never expires. */
  connectionExpiresInDays: number | null;
  accessProtected: boolean;
  lastSync: { source: string; finishedAt: string | null; status: string; message: string | null } | null;
  latestDate: string | null;
  targets: Targets;
  pods: { id: string; code: string; name: string; color: string }[];
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
}

export interface PostSummary {
  postId: string;
  name: string;
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
  name: string;
  color: string | null;
  totals: Totals;
  concepts: number;
  hits: number;
  misses: number;
  testing: number;
  hitRate: number | null;
  editors: { editorId: string | null; name: string; totals: Totals; concepts: number }[];
}

export interface PodsResponse {
  from: string;
  to: string;
  rows: PodRow[];
}
