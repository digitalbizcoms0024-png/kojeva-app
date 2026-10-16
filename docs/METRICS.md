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
- CPA: ✓ ≤ $14 · ! ≤ $17.50 (125%) · ✕ above
- ROAS: ✓ ≥ 1.7 · ! ≥ 1.36 (80%) · ✕ below

## Hit rate
- A **concept** is one **testing ad set**: an in-house one naming a strategist ("IH | Harris | KOJEVA 3 |
  STATIC | Scarcity" in ABO, "Shameer | Static 3 | Negative Marketing #2" in CBO) or an agency one
  (ME/QW/TV/YD). Scaling ad sets are never concepts, so copies of winners can't count twice.
- Older ad sets that combined concepts are split by ad name (`shared/concepts.ts`): "Batch 3 & 5" →
  Batch 3 ("batch 3a", "batch 3b") and Batch 5 ("batch5"); "Depuffing + Jawline" → by which word the
  ad's hook mentions. A "+" is only split when the ad names clearly name the parts.
- Its **test window** is the first `testWindowDays` (3) days from the concept's first day with spend,
  summing every ad in that ad set (or part).
- Status:
  - **testing**: fewer than 3 days of data so far
  - **ineligible**: window spend < `minTestSpend` ($100); excluded from hit rate
  - **hit**: window CPA ≤ $14 **and** window ROAS ≥ 1.7 (`hitRule: "either"` allows either one)
  - **miss**: otherwise (including zero purchases)
- **Hit rate** = hits ÷ (hits + misses).
- A concept counts toward the period in which it **first spent**.
- An ad's "Hit" badge in Rankings shows the result of the concept it was tested in.

## Pending confirmation
- Hit rule: both targets, or either? (default: both)
- Minimum test spend (default: $100)
- Should the test window only count the testing campaign (ABO)? (default: all copies)
