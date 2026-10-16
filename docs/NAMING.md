# Ad naming

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

Legacy names set a pod only when a strategist is named in them (HARRIS, DHIA, SHAMEER, ALI as a
separate word). A prefix such as `HxM` maps to a pod only after it's added to the legacy prefix map in Settings. Everything else goes to **Needs Tagging**.

## Open questions
- What does `HxM` stand for, and which pod is it?
- Is there a tracker mapping `Video N` / `batchN` numbers to strategists? (It would tag most old ads in one import.)
