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
- **Best ad decides**: every ad in the concept is also judged on its own the same way (its first spend
  to day 3 or the day *it* reached $100, plus its own late-hit look). The concept takes the best result
  of itself and its ads (hit > late hit > testing > miss > not at $100; `bestStatus`), and records the
  ad that decided it (`decidedBy`, shown as "via <ad name>"). Example: Harris "KOJEVA 3 | STATIC |
  Scarcity" missed combined (days 1–3 CPA $17.14) but its "Almost Sold Out" ad hit on its own
  (Sep 18–21, CPA $12.60, ROAS 2.47), so the concept is a hit.
- Status:
  - **testing**: the judging window hasn't passed yet
  - **No ad at $100** (`ineligible`): window passed and no ad has reached $100; not counted
  - **hit**: window CPA ≤ $14 **or** window ROAS ≥ 1.7 (Kojeva's rule, `hitRule: "either"`; Settings can switch to "both")
  - **miss**: otherwise (including zero purchases)
- **Hit rate** = hits ÷ (hits + misses).
- A concept counts toward the period in which it **first spent**.
- An ad's "Hit" badge in Rankings shows the result of the concept it was tested in.

## Pending confirmation
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

## Late hits (`shared/metrics.ts` → `lateHitWindow`)
- A concept that **missed** its day-3 test but **kept spending after** its judging window gets a second look: if any run of
  `lateWindowDays` consecutive days (default 7, Settings → "Late-hit window"; 0 turns it off) from first spend onward, ending
  after the judging window, has at least the qualifying spend ($100) and meets the targets, it becomes a **Late hit**.
- Late hits count in the hit rate (hits + late hits ÷ decided) and are shown split out: "7 hits from 20 decided (2 late)".
- Until then it stays a **Miss**; one still spending in the last 3 days is labelled "Miss · still running". Once any window hits,
  the late hit is permanent (more days can only add windows).

## Spend by pod
- Pods page section (and a share bar on the Dashboard): spend per pod, the agency and unassigned for the global range, share of
  total, and change vs the period before (same length). Spend changes are shown without good/bad color.

## Concepts launched per week
- New concepts per pod by the Monday–Sunday week of their first spend, last 8 weeks, ending with the week of the latest synced
  day ("This week"). The Dashboard pod cards show this week's count. `/api/launches`.

## Date range
- Last 7 days · Last 30 days (both end on the latest synced day) · Month to date (from the 1st of that day's month, same as Ads Manager's "This month") · All time · Custom (any from–to). Every page follows it. Deltas compare with the period before; month to date compares with the same days of the previous month.

## Creative Insights dimensions
| Panel | Source |
|---|---|
| By angle / By format | Read from names (`shared/classify.ts`), hand-set wins |
| By awareness level | Claude's label per creative (nightly Atria task), most common across the concept; hand-set wins |
| By hook type | Atria `visual_hook` |
| By avatar | Atria `persona` |
| By mass desire | Atria `core_desire` |
| By belief shifted | Claude's belief group per creative; hand-set wins |
| By Atria theme | Atria `theme` |

Atria and belief panels are multi-valued: a concept counts under each of its values, so rows overlap.
All panels use the same concept test results (judging window, late hits) as the hit rate.

## Incrementality (`/api/attribution`, Incrementality page)
Meta's 7-day click and incremental attribution on the same Meta spend, side by side, as in Ads Manager's
Compare attribution settings (checked against it in Oct 2026). The ad set's own setting (`purchases` /
`revenue_cents`, used everywhere else; hit rate and targets stay on it) is kept in the API (`standard`) but
not shown on the page.
- **7-day click**: purchases within 7 days of a click (`purchases_7dc`, `revenue_7dc_cents`).
- **Incremental**: Meta's modelled estimate of purchases that wouldn't have happened without the ad (`purchases_inc_milli` ÷ 1000, `revenue_inc_cents`). Can be fractional.

Both come from a second insights request per sync with `action_attribution_windows=["7d_click","incrementality"]` (`worker/meta/sync.ts` → `syncAttributionWindows`). It only updates existing `ad_daily` rows whose values changed. If Meta refuses it, the sync still succeeds and its message says "7-day click / incremental not available". Missing stays NULL and shows "—", never 0.

- **Incremental CPA** = spend ÷ incremental purchases; **incremental ROAS** = incremental revenue ÷ spend (`attributedCpa`, `attributedRoas`). No good/bad colors: the targets are set on the ad sets' own attribution setting.
- **Incremental share** = incremental purchases ÷ 7-day-click purchases (`incrementalShare`), or null when either is missing or 7-day click is 0. Low share = the ad mostly reached people who'd have bought anyway. It can pass 100%: Meta's incremental model also credits purchases 7-day click doesn't count (e.g. after a view).
- **Coverage** = spend on ad-days that have incremental data ÷ all spend; shown when below 100% (e.g. before the backfill).
- History: run Settings → Backfill 90 days once after deploying. It rewrites ~90 days of rows, so do it on a quiet day for D1 writes.

## Coverage map (`worker/coverage.ts`, `/api/coverage`)
Personas down the side, the five awareness levels across the top. Defaults to the last 7 days.
- **Running ad** = a post (copies grouped) with spend in the selected period.
- **Placement**: persona = hand-set, else Claude's label for the post's creative; same for awareness and
  offer. Posts missing either sit in "No persona yet" / "Not labelled" and count as **not on the map**.
- **Cell**: running ads, spend, share of all spend in the period, CPA/ROAS (Meta; TW beside it in the
  cell detail), offer share = spend on ads with a discount/offer ÷ spend on ads whose offer is known.
- **Hit rate in a cell** is every concept ever tested there (all time), placed by the concept's persona
  (hand-set on any of its ads, else the most common Claude label) and awareness. So an empty cell can
  still show "tested before".
- **Cells with ads running** = placed cells (persona and awareness known) with at least one running ad,
  out of personas × 5.
- **Biggest cell** = the placed cell with the most spend. Dashboard alert when it holds over 60% of the
  last 7 days' spend (`CONCENTRATION` in `worker/alerts.ts`).
- Shading is one neutral color by spend share; good/bad colors stay on CPA and ROAS.
