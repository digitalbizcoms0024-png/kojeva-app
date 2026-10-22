# Ad naming & pod attribution

## How a post gets its pod (`shared/attribution.ts`)

Kojeva separates pods by **ad set**. In-house ABO testing ad sets were named `IH | <Strategist> | …`
("IH | Harris | KOJEVA 3 | STATIC | Scarcity"); CBO testing ad sets (campaign "CBO | Internal Pod |
Testing") just lead with the name ("Shameer | Static 3 | Negative Marketing #2"). Before the pods, an **agency** made the ads; its ad
sets start with `ME`, `QW`, `TV` or `YD` ("ME | R2-S12 | Statics"). Ad names are mostly free-form
and carry no meaning (e.g. "HxM").

**Added pods** (Settings → Pods & agency → Added pods) are teams or partners beyond the four
strategists, matched by a **prefix** that is one of the ad set name's `|` parts: Trybe's ad sets are
`TRYBE | <creator> | <angle>` ("TRYBE | Larissa V | Jawline Angle"). They're counted like any pod.
Up to three, each with a validated color (`POD_SLOTS` in `shared/taxonomy.ts`); adding or removing one
re-credits every ad except hand-set ones.
- A prefix matches ignoring case, spaces and punctuation, or as a part's first word: `POD0` matches
  "Pod 0 | Andrei | …" and `CAICOS` matches "Caicos Pod | …".
- **In-house** (a tick per pod, migration 0027): Kojeva's own teams. The four built-in pods, Caicos (Pod 5)
  and Pod 0 are in-house; Trybe, a partner, isn't. The Ad Rankings "In-house pods" view follows the tick.
- **Strategists** (per pod, migration 0028): a pod run by several strategists lists them (Pod 0: Andrei,
  Reika, Adrian) and names one in each ad set ("POD0 | Andrei | Depuff Static"). Each gets their own hit
  rate on the Pods page and in the CS report (`shared/strategists.ts`); the pod's own numbers don't change.

First match wins:
1. **Set by hand** in the app. Never overwritten by a sync.
2. **Pod code** in a standard ad name (`HAR-…`, `DHI-…`, `SHA-…`, `ALI-…`).
3. **Strategist named in the ad set** as a separate word ("IH | Dhia | …" → Dhia).
   The ad set of the post's **earliest** ad is checked first, so a winner copied into unnamed
   Scale ad sets ("Top Spenders From ABO", "May Winners") keeps the pod that made it. An ad set
   naming two strategists is skipped.
4. **Agency ad set**: first segment is one of the agency codes → Agency.
5. **Strategist named in the ad name** (`…VSL_HARRIS-h2`).
6. A legacy prefix configured in Settings (none configured; prefixes like "HxM" are random).
7. **Launched before the pods started** → Agency. The start date is detected as the first ad in a
   strategist-named ad set, unless `podsStartDate` is set in the `attribution` setting.

Anything left (launched after pods started, untraceable) goes to **Needs Tagging**. The agency
is shown beside the pods with its own hit rate, never inside a pod's numbers.

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

## Angle and format from names (`shared/classify.ts`)

Ad names rarely carry tags, but concept and ad set names usually do: "KOJEVA 3 | STATIC | Scarcity",
"Shameer | Native Ad | …", "KOJEVA 15 | DOUBLE CHIN", "ST _ Depuffing _ …". Keyword rules, most specific
first, read the concept label, then the ad set name, then ad names. Add keywords there (with a test
using the real name) as naming evolves. Hand-set tags always win.

Format words the rules know: Static, UGC static, UGC, AI UGC, AI voiceover / B-roll, UGC montage, AI drama,
Song, Pixar song ("ANIMSONG", or Pixar / animation together with "song"), Product demo, Mixed media, VSL,
Video, Native ad / advertorial / listicle, Podcast, Interview, Animation (or "Pixar", without a song), Carousel. What each means is in `FORMAT_DEFINITIONS` (`shared/taxonomy.ts`), the media buyer's
definitions; the nightly Atria task suggests a format from the ad's frames and Atria's tags (a suggestion
only, accepted in Needs Tagging). Put one in the ad set name
("Dhia | AI UGC | Problem Vs Solution 2") and the concept is tagged without anyone doing it by hand.
Names without one (KOJEVA 15's videos, Dhia's "…_Brief" sets) were tagged by the media buyer in
migrations 0018, 0021 and 0023, after checking each ad.

## Open questions
- Do older ad sets (before the naming habit started) also carry strategist names? If not, a tracker
  mapping creative numbers to strategists would tag those in one import.
