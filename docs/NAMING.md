# Ad naming & pod attribution

## How a post gets its pod (`shared/attribution.ts`)

Today Kojeva separates pods by **ad set**: each creative strategist's name is in the names of the
ad sets that hold their ads. Ad names are mostly free-form and carry no meaning (e.g. "HxM").

First match wins:
1. **Set by hand** in the app. Never overwritten by a sync.
2. **Pod code** in a standard ad name (`HAR-…`, `DHI-…`, `SHA-…`, `ALI-…`).
3. **Strategist named in the ad set** as a separate word ("ABO | Harris | Oct" → Harris).
   The ad set of the post's **earliest** ad is checked first, so a winner copied into unnamed
   Scale / Graveyard ad sets keeps the pod that made it. An ad set naming two strategists is skipped.
4. **Strategist named in the ad name** (`…VSL_HARRIS-h2`).
5. A legacy prefix configured in Settings (none configured; prefixes like "HxM" are random).

Anything left goes to **Needs Tagging**.

## The convention (for all new ads)

```
POD-CREATIVEID[-iN] | Angle | Format | Hook | LandingPage
HAR-V612-i2 | Depuff | UGC | Story | PDP
```

| Part | Values | Required |
|---|---|---|
| POD | `HAR` Harris · `DHI` Dhia · `SHA` Shameer · `ALI` Ali | yes |
| CREATIVEID | `V612` or `612` (letter optional) | yes |
| `-iN` | iteration of the same concept | no |
| Angle / Format / Hook / LandingPage | from `shared/taxonomy.ts`; `-` when unknown | positions fixed |

Use the in-app **Naming Tool** to build names. Meta's " - Copy", " - Copy 3" suffixes are fine; they're
stripped before parsing, and copies are grouped by post anyway.

## Legacy names (how the parser reads them)

| Pattern | Example | Read as |
|---|---|---|
| `Video N`, `VN` | `Video 153`, `V457` | creative `V153`, `V457` |
| `batchN-M` | `batch15-2` | creative `B15`, iteration 2 |
| `NvM` | `23v2` | creative `23`, iteration 2 |
| `N-M` | `4-2` | creative `4`, iteration 2 (meaning unconfirmed) |
| `PREFIX-N` / `PREFIX N.M` | `HxM-120 …`, `HxM 7.1 …` | prefix `HxM`, creative `HxM-120`, iteration 1 |
| ` \| CBO`, ` \| PDP`, ` PDP` | `V457 \| CBO`, `V556 PDP` | campaign hint / landing page |
| `PREFIXN-…` | `HxM2-Yapper Founder-2` | prefix `HxM`, creative `HxM-2` |
| Strategist name anywhere | `GS_SA_COMPARISON VSL_HARRIS-h2` | suggests Harris's pod; also picks out Comparison / VSL |
| ` \| Post ID` suffix | `kojeva 10 HK2 \| Post ID` | ignored (ad launched from an existing post) |
| `Copy of …` prefix | `Copy of 22v1` | copy of creative `22`, iteration 1 |
| Underscore tokens | `Funeral_MatureFace_UGC_Story` | known tags are picked out (angle MatureFace, format UGC, hook Story) |

Prefixes like `HxM` are random and don't identify a pod; the ad set does (see above).

## Open questions
- Do older ad sets (before the naming habit started) also carry strategist names? If not, a tracker
  mapping creative numbers to strategists would tag those in one import.
