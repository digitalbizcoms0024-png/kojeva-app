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
- **Exception, one concept per static**: ad sets listed in `ONE_CONCEPT_PER_AD` (`shared/concepts.ts`)
  held several separate statics grouped only at launch, so each distinct static is its own concept
  (V1/V2 versions together). Today only Harris "KOJEVA 3 | STATIC | Scarcity": Almost Sold Out
  (hit), Get It or Regret It (late hit) and Empty Warehouse (under $100) are three concepts.
- A concept **qualifies** once any single ad in it has spent `minTestSpend` ($100) in total.
- It's **judged** on all its ads combined, from its first day of spend to day `testWindowDays` (3) or
  the day it qualified, whichever is later. A slow CBO concept that qualifies on day 6 is judged on
  days 1–6.
- The concept is judged as a whole; single ads inside it are not judged on their own.
- Status:
  - **testing**: the judging window hasn't passed yet
  - **No ad at $100** (`ineligible`): window passed and no ad has reached $100; not counted
  - **hit**: window CPA ≤ $14 **or** window ROAS ≥ 1.7 (Kojeva's rule, `hitRule: "either"`; Settings can switch to "both")
  - **miss**: otherwise (including zero purchases)
- **Turned off** (owner, Oct 28): once every ad in a concept is off (paused itself, by its ad set or
  campaign, archived or deleted; `OFF_STATUSES`), a concept still testing or with no ad at $100 is
  judged at once on everything it spent, whatever it spent, from first spend to its last day of
  spend (`judgeTurnedOff`, `turnedOff` in the API). Results already decided stay as they were. The
  on/off status is Meta's at the last sync. The judging code is in the rules fingerprint
  (`worker/rules.ts`), so a deploy that changes it recomputes without a sync.
- **Hit rate** = hits ÷ (hits + misses).
- **Pod score** (Dashboard leaderboard order; `podScores` in `shared/metrics.ts`, owner, Oct 28), out of 100:
  hit rate (`scoreWeightHitRate`: pod's hit rate ÷ `scoreFullHitRate` 20%, capped at 1, so every pod at
  20% or above gets full points and a pod's points don't depend on the others; × decided ÷ `scoreMinDecided`
  (5) below 5 decided concepts, owner Oct 28, after Ali ranked 2nd on 1 hit in 2) + spend (`scoreWeightSpend`, 40: pod's
  spend in the period ÷ biggest pod's) + ROAS (`scoreWeightRoas`, 20: pod's ROAS ÷ target ROAS, capped at
  1, × min(1, spend ÷ `scoreRoasMinSpend` $300)). In-house pods only (never Agency or partners like Trybe), on the Dashboard and the top of the Pods page; ties go to spend. Weights in
  Settings → Targets (must add up to 100).
- **Testing now** (pod leaderboard, Pods page; owner, Oct 28): every concept with an ad switched on in
  Meta (not paused at any level, archived, deleted or disapproved), spending or not, whatever its result
  so far, as of the last sync. It counts concepts, not ads. "Testing" alone is narrower: still inside
  the judging window.
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
- **Purchases but no spend** (✕): ad-days in the last 30 with purchases and no spend or impressions, an incomplete report from Meta (seen Oct 2026, which made CPA/ROAS look ~3× better). A backfill (Settings → Data sources, 90 days) re-pulls them. The sync itself keeps one row per ad and day (the one with delivery) and never lets such a day replace stored spend; it counts them in its message.
- **Fatigue** (✕): Fatigued posts, and posts whose only signal is CPA (a CPA jump is worth a look on its own); biggest recent
  spend first, at most 3.
- **Hit** (✓): a concept whose judging window closed in the last 7 days as a hit. "View concept" opens its card (`?concept=<id>` on any page,
  `src/components/ConceptDrawer.tsx`, data from `GET /api/concepts/:id`); concept names in the Concepts table open it too.
- **Needs a pod** (!): posts with spend in the last 7 days that no pod or the agency is credited with.
- **Hit turned off** (!): a hit or late hit that just stopped running **everywhere**: every copy of every creative tested in the
  concept (same video/image by `asset_id`, else the same post, in any ad set) has an off status in Meta (paused, ad set/campaign paused,
  archived, deleted, disapproved, with issues) or spent nothing in the last 3 synced days, after its copies spent at least
  $20 in the 7 days before that (`RUNNING_MIN_CENTS`). Pausing the test ad after scaling doesn't count while a copy still runs (owner, Oct 18). Pausing a winning ad set's weak variations doesn't count while its winner still runs (owner, Oct 22). One alert per
  concept, at most 3; each shows for about a week (`worker/hitsoff.ts`).
- **Rankings → Status → Hits turned off** lists every winner that is off everywhere now, however long ago it stopped, by its
  test post (hit badge), whatever the range spent.
- Computed on read from stored data; no D1 writes.

## Pod suggestions (Needs Tagging)
- **High:** the same video/image (`ads.asset_id`) runs in a post credited to exactly one pod.
- **Medium:** the ad name contains exactly one roster editor's name (as a whole word), and that editor has a pod.
- Never applied automatically; accepting one sets the pod by hand (`manual`).

## Trends (`/api/trends`)
- Spend (Meta), CPA and ROAS by day or by Monday-start week, for the account, one pod or unassigned ads. Defaults to weekly
  for ranges over ~2 months.

## Ad Rankings minimum spend (`/api/rankings`)
Ranking by purchases, ROAS, CTR or CPA only includes posts that spent at least `rankMinSpendPerDay` (Settings → Targets, default $50) × the days in the range; All time counts from the first day anything spent. Ranking by spend, and the turned-off-hits list, show every post. `?all=1` (the page's "Show them") lifts the minimum. Changing it doesn't recompute the summaries (it's applied per request).

## Ad Rankings page (owner, Oct 28)
- Sorted by ROAS by default (so the minimum above applies); Cards or a Table view (50 a page, columns re-sort).
- Show: in-house pods (default) or all with agency & partners, for the Ads, Pods and Editors tabs.
- Presets: All ads · New: past week (`?launched=1w`, first spend in the last 7 days) · New: past 2 weeks
  (`?launched=2w`, since Monday of last week). New is always in-house pods only.
- Quick filters (`?status=`): `hits` (the concept it was tested in is a hit, late hit or called winner),
  `scaling` (an active copy outside testing ad sets), `fatigued` (Watch), `hits_off` (Turned off).
- **Days live** = latest synced day − (launch, or first spend if earlier) + 1. First spend alone stopped
  at the start of the synced history, so older ads all read "101 days live".

## Ad Swipe (owner, Oct 29)
One post at a time, ← / → (keys or buttons; a bottom bar on a phone). View-only. Deck = `/api/rankings` with
the page's filters: format (`?media=image|video`), pod (default in-house pods), status (default running now),
order (spend default, ROAS, newest launch). Each card is `/api/posts/:id` for the global range.
- The ad shows as Meta's preview straight away (`/api/posts/:id/preview`, Facebook feed first; tabs for
  Instagram feed, Reels, Story): copy, headline, reactions and comment count, and videos play in place. One Graph
  read per card and placement viewed; without Meta it falls back to the thumbnail.
- **Outbound CPC** = spend ÷ Meta `outbound_clicks` (not unique). **Cost per add to cart** = spend ÷ adds to cart
  (`omni_add_to_cart`, else pixel add to cart). Both stored in `ad_daily` from Oct 29 (migration 0031); a range
  containing a spend day without them shows "—", never a partial number.
- **Daily frequency** with its funnel band, as below.
- **Running N days** = Days live as on Ad Rankings; "where it runs" lists the 5 biggest-spending copies.

## CSV export
- Rankings (current filters), Concepts and the Pods table. Money in plain dollars, every value labelled with its source;
  missing values are empty cells, never 0.

## Late hits (`shared/metrics.ts` → `lateHitWindow`)
- A concept that **missed** its day-3 test but **kept spending after** its judging window gets a second look on each day D
  that is day `lateWindowDays` (default 7, Settings → "Late-hit window"; 0 turns it off) or later, after the judging window
  and synced. It becomes a **Late hit** on the first such D where **either** look has at least the qualifying spend ($100)
  and meets the targets (owner, Oct 18):
  - **Totals since launch**: first spend → D, the bad first days included (window shown as first spend → D).
  - **Rolling 7 days**: the 7 days ending on D (D−6 → D). It may overlap the test days, as long as it ends after them.
  Since launch is shown when both hit on the same day.
- Late hits count in the hit rate (hits + late hits ÷ decided) and are shown split out: "7 hits from 20 decided (2 late)".
- Until then it stays a **Miss**; one still spending in the last 3 days is labelled "Miss · still running". Once a look hits,
  the late hit is permanent.

## Hit (call) (`worker/calls.ts`, `winnerCandidate` in `shared/metrics.ts`)
A top-of-funnel creative that takes major spend and measurably lifts the account can be called a
**Hit (call)**, or **Super hit (call)** if it's a real scaler (shown that way; stored as status `winner` / `super_winner`), even when its own ROAS is below target (owner's
rule, Oct 2026). Only the media buyer makes the call (`MEDIA_BUYER_EMAILS`), tied to the creative's data:
- **Candidates** are flagged automatically: a concept that missed its test, with ROAS since launch ≥
  `winnerMinRoas` (1.5) on ≥ `winnerMinSpend` ($1,000) over ≥ `winnerMinDays` (5) days; a possible super
  winner from `superWinnerMinSpend` ($5,000). The media buyer sets these in Settings → Targets.
- **Evidence** (concept card): the whole account in the 7 days before the concept's first spend vs its
  first 14 days (Meta ROAS, CPA, purchases a day), also without the concept's own results ("did the rest
  improve?"), the MOF/BOF ads (product- and most-aware), the concept's share of test spend and purchases,
  and its Meta incremental ROAS. It's a before/after comparison, not proof.
- **The call** needs a one-line reason and stores the evidence as it was. Syncs never change it; the
  media buyer can undo it. A called concept's status is `winner` / `super_winner` and counts as a hit
  everywhere (`isHit`), labelled "(call)". MER can't be shown: the hub has Meta numbers only.

## CS report (`worker/report.ts`, CS Reports page)
Fortnightly, Monday to Sunday (`shared/periods.ts`): report 1 is Sep 18 – Oct 4, 2026 (written by hand),
then Oct 5 – 18, Oct 19 – Nov 1, and so on.
- **A concept counts in the period it launched** (first spend). **Eligible** = an ad reached
  `minTestSpend`; the hit rate is hits (on target, late hits, winners by call) ÷ eligible.
- **Spend on this period's concepts**: their spend inside the period. **All testing spend**: every pod
  concept's spend in the period, including earlier ones still running. Agency and scaling ad sets are
  never in either.
- **Late verdicts**: concepts from earlier periods whose result came in during this one (their window
  closed, a late-hit window ended, or a winner call). They stay in their launch period's numbers, which
  the report shows "as it stands now" for the previous period.
- Per pod: totals, hits, the strongest miss (a candidate is marked), and output by format. Formats won
  count eligible concepts by format.
- **Learnings and read** are drafted by a scheduled Claude task each Monday after a period closes
  (`/api/ingest/report/due`, `…/report?from&to`, `…/report/draft`; service token only), and edited by
  editors in the hub. Once edited, a draft never replaces it. Copy for Slack copies the same text as
  rich text (bold and bullets survive) with a mrkdwn fallback.

## Spend by pod
- **In-house** view (default): the share bar and Share column cover in-house pods only (Settings → In-house tick); the agency, partners (Trybe) and uncredited spend are left out of the bar and the table; switch to **All spend** to see them. **All spend** shows everyone in one bar, as before.
- Pods page section (and a share bar on the Dashboard): spend per pod, the agency and unassigned for the global range, share of
  total, and change vs the period before (same length). Spend changes are shown without good/bad color.

## Average daily frequency and funnel (owner, Oct 29; `dailyFrequency`, `funnelBand` in `shared/metrics.ts`)
Which pod brings the most new eyeballs into the funnel.
- **Average daily frequency** = Σ impressions ÷ Σ reach over each ad's days (Meta's reach is per ad per day), so
  bigger ads weigh more. Days without reach are left out of both sides; none at all → "—". `Totals.reach` and
  `Totals.reachImpressions` carry the two sums everywhere totals go.
- **Funnel band** (rounded to 2 decimals; Settings → Targets `freqTopMax`, `freqMiddleMax`): ≤ 1.15 top of funnel,
  ≤ 1.25 middle, above bottom (the owner's 1.26–1.35, and higher counts as bottom too). Neutral shades, not status colors.
- **Pods → Reach by pod** (after Spend by pod): each pod's average over all its ads in the range (scaling copies
  included; a pod + partner ad set counts for both), lowest first with ★ Most new eyeballs; the pod's spend split by
  each ad's own band (`PodRow.funnelSpend`); "Its ads" opens Ad Rankings sorted by frequency, lowest first.
  Below it the last 8 Monday-start weeks per pod (`/api/pods/frequency`, per post per week once per sync, grouped by current tags).
- Ad Rankings: Frequency column and sort (`sort=freq`), and on cards and the side card. Ad Swipe: Daily frequency with the band.
  The ranking minimum spend applies to the frequency sort as to the other ratios.

## Concepts launched per week
- New concepts per pod by the Monday–Sunday week of their first spend, last 8 weeks, ending with the week of the latest synced
  day ("This week"). The Dashboard pod cards show this week's count. `/api/launches`.

## Date range
- Last 7 days · Last 14 days · Last 30 days (all end on the latest synced day) · Month to date (from the 1st of that day's month, same as Ads Manager's "This month") · All time · Custom (any from–to). Every page follows it. Deltas compare with the period before; month to date compares with the same days of the previous month.

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
| By motivation | Claude's motivation tags per creative, union across the concept; hand-set lists win |
| By persona | Confirmed personas (Settings); before that, Atria's raw persona tags ("By avatar") |

Atria, belief and motivation panels are multi-valued: a concept counts under each of its values, so rows overlap.
All panels use the same concept test results (judging window, late hits) as the hit rate.

Panels are grouped into tabs: Creative (angle, format, hook), Audience (persona, motivation, awareness,
mass desire), Message (belief, theme) and Combinations (`/api/insights/matrix`: hit rate per pair of two
dimensions, default angle × format, tagged concepts only). Each panel's dashed line is the **average**: the
hit rate of every concept in the period and pod (`baseline`). Untagged concepts are a footnote, not a row.

**Hit-rate floor** (`hitRateFloor` in `shared/metrics.ts`): the lower bound of the 90% Wilson interval for
hits / decided. "Best first" sorts by it, so a long record beats a short perfect one (3/3 floor 0.53 vs
25/30 floor 0.70). Values with fewer than `MIN_DECIDED` (3) decided tests are hints: grey and sorted last.

**Make more of** (`/api/insights/overview`, `worker/insights.ts`): per dimension (angle, format, motivation,
hook type, awareness, persona), the tagged value with the highest floor among those with ≥ 3 decided tests
whose hit rate beats the average; up to 4 shown, highest floor first. **No hits yet**: angle/format values
with ≥ 3 decided tests and 0 hits, most test spend first (top 3). All of it comes from the cached concept
results, so it adds no `ad_daily` reads.

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
- **Cell**: running ads, spend, share of all spend in the period, CPA/ROAS (Meta), offer share = spend on ads with a discount/offer ÷ spend on ads whose offer is known.
- **Hit rate in a cell** is every concept ever tested there (all time), placed by the concept's persona
  (hand-set on any of its ads, else the most common Claude label) and awareness. So an empty cell can
  still show "tested before".
- **Cells with ads running** = placed cells (persona and awareness known) with at least one running ad,
  out of personas × 5.
- **Biggest cell** = the placed cell with the most spend. Dashboard alert when it holds over 60% of the
  last 7 days' spend (`CONCENTRATION` in `worker/alerts.ts`).
- Shading is one neutral color by spend share; good/bad colors stay on CPA and ROAS.
