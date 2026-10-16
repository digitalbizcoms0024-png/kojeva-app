# Metric definitions

Code: `shared/metrics.ts` (tested in `shared/metrics.test.ts`). Source for all of these in v1: **Meta-reported**.

| Metric | Definition | When undefined |
|---|---|---|
| Spend | Σ spend | — |
| Purchases | Σ Meta purchase conversions (account attribution setting) | — |
| CPA | spend ÷ purchases | 0 purchases → "—" |
| ROAS (Meta) | purchase value ÷ spend | 0 spend → "—" |
| Link CTR | link clicks ÷ impressions | 0 impressions → "—" |

Totals for a post = sum over **all its copies** (every ad sharing the post ID).

## Color bands
- CPA: ✓ ≤ $14 · ! ≤ $17.50 (125%) · ✕ above
- ROAS: ✓ ≥ 1.7 · ! ≥ 1.36 (80%) · ✕ below

## Hit rate
- A **concept** is a post (Phase 3 adds concept grouping across posts).
- Its **test window** is the first `testWindowDays` (3) days from its first day with spend, across all copies.
- Status:
  - **testing**: fewer than 3 days of data so far
  - **ineligible**: window spend < `minTestSpend` ($100); excluded from hit rate
  - **hit**: window CPA ≤ $14 **and** window ROAS ≥ 1.7 (`hitRule: "either"` allows either one)
  - **miss**: otherwise (including zero purchases)
- **Hit rate** = hits ÷ (hits + misses).
- A concept counts toward the period in which it **first spent**. A winner copied into scaling
  campaigns is still one concept, so copies can't inflate a pod's hit rate.

## Pending confirmation
- Hit rule: both targets, or either? (default: both)
- Minimum test spend (default: $100)
- Should the test window only count the testing campaign (ABO)? (default: all copies)
