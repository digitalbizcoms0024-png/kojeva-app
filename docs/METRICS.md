# Metric definitions

Code: `shared/metrics.ts` (tested in `shared/metrics.test.ts`). Source for all of these in v1: **Meta-reported**.

| Metric | Definition | When undefined |
|---|---|---|
| Spend | Σ spend | — |
| Purchases | Σ Meta `omni_purchase` actions (what Ads Manager's Purchases column shows), falling back to `purchase`, then `offsite_conversion.fb_pixel_purchase`. Account's default attribution setting. | — |
| CPA | spend ÷ purchases | 0 purchases → "—" |
| ROAS (Meta) | purchase value (same action type) ÷ spend | 0 spend → "—" |
| Link CTR | link clicks ÷ impressions | 0 impressions → "—" |

Totals for a post = sum over **all its copies** (every ad sharing the post ID).

## Color bands
- CPA: ✓ ≤ $14 · ! up to the amber limit (Settings → "Amber up to"; empty = 125% of target, $17.50) · ✕ above
- ROAS: ✓ ≥ 1.7 · ! ≥ 1.36 (80%) · ✕ below

## Hit rate
- A **concept** is one **testing ad set**: an in-house one naming a strategist ("IH | Harris | KOJEVA 3 |
  STATIC | Scarcity" in ABO, "Shameer | Static 3 | Negative Marketing #2" in CBO) or an agency one
  (ME/QW/TV/YD). Scaling ad sets are never concepts, so copies of winners can't count twice.
- Older ad sets that combined concepts are split by ad name (`shared/concepts.ts`): "Batch 3 & 5" →
  Batch 3 ("batch 3a", "batch 3b") and Batch 5 ("batch5"); "Depuffing + Jawline" → by which word the
  ad's hook mentions. A "+" is only split when the ad names clearly name the parts.
- A concept **qualifies** once any single ad in it has spent `minTestSpend` ($100) in total.
- It's **judged** on all its ads combined, from its first day of spend to day `testWindowDays` (3) or
  the day it qualified, whichever is later. A slow CBO concept that qualifies on day 6 is judged on
  days 1–6.
- Status:
  - **testing**: the judging window hasn't passed yet
  - **No ad at $100** (`ineligible`): window passed and no ad has reached $100; not counted
  - **hit**: window CPA ≤ $14 **and** window ROAS ≥ 1.7 (`hitRule: "either"` allows either one)
  - **miss**: otherwise (including zero purchases)
- **Hit rate** = hits ÷ (hits + misses).
- A concept counts toward the period in which it **first spent**.
- An ad's "Hit" badge in Rankings shows the result of the concept it was tested in.

## Pending confirmation
- Hit rule: both targets, or either? (default: both)
- Minimum test spend (default: $100)
- Should the test window only count the testing campaign (ABO)? (default: all copies)

## Fatigue (`shared/fatigue.ts`)
- Compares a post's **last 3 synced days** with its **first 7 days of spend**. Only posts spending in the last 3 days, at least
  10 days old, with ≥ $150 spend in the last 3 days.
- Signals: **frequency** (impressions ÷ reach) up ≥ 25% · **link CTR** down ≥ 25% · **CPA** up ≥ 30% *and* above the amber limit
  (no purchases on that spend counts as a CPA rise).
- 2+ signals = **Fatigued** (✕), 1 = **Watch** (!). Shown on ranking cards, in the ad detail and in the Status filter.
- Reach is stored per ad per day (from Oct 2026 syncs on). Window reach sums daily reach, so frequency is approximate
  but comparable between the two windows; without reach for a window, the frequency signal is skipped, not zero.

## Dashboard alerts (`worker/alerts.ts`)
- **Fatigue** (✕): Fatigued posts, and posts whose only signal is CPA (a CPA jump is worth a look on its own); biggest recent
  spend first, at most 3.
- **Hit** (✓): a concept whose judging window closed in the last 7 days as a hit.
- **Needs a pod** (!): posts with spend in the last 7 days that no pod or the agency is credited with.
- Computed on read from stored data; no D1 writes.

## Pod suggestions (Needs Tagging)
- **High:** the same video/image (`ads.asset_id`) runs in a post credited to exactly one pod.
- **Medium:** the ad name contains exactly one roster editor's name (as a whole word), and that editor has a pod.
- Never applied automatically; accepting one sets the pod by hand (`manual`).

## Triple Whale (`shared/metrics.ts`, `docs/TRIPLE_WHALE.md`)
- **ROAS · TW** = Triple Whale attributed revenue ÷ Meta spend. **CPA · TW** = Meta spend ÷ Triple Whale
  attributed orders (fractional under this model). Same color bands as Meta's values.
- Model: Clicks & deterministic views (`Clicks & Views` in Triple Whale's data), lifetime window.
- Never summed with Meta's purchases or revenue. "—" when no day in the period is synced.
- Hit rate and concepts stay on Meta's numbers.

## Trends (`/api/trends`)
- Spend (Meta), CPA and ROAS by day or by Monday-start week, for the account, one pod or unassigned ads. Defaults to weekly
  for ranges over ~2 months. Meta solid, Triple Whale dashed (only in buckets with a synced Triple Whale day).

## CSV export
- Rankings (current filters), Concepts and the Pods table. Money in plain dollars, every value labelled with its source;
  missing values are empty cells, never 0.
