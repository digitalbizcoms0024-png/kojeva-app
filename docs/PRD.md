# Kojeva Hub — Product requirements

## Problem
Kojeva runs ~1,000+ Meta ads made by 4 creative pods, each led by a creative
strategist: **Harris, Dhia, Shameer, Ali**. Ads Manager can't answer:

1. Which ads and concepts are actually winning (counting copies once)?
2. Which pod is producing winners, and how often (hit rate)?
3. What angles, formats and hooks are behind the winners?
4. What should we scale, iterate or kill, and what should each pod make next?

Ad names are inconsistent ("Video 153", "V457 | CBO", "HxM 7.1 Funeral_MatureFace_UGC_Story",
"batch15-2", "23v2 - Copy"). Pods are identified by **ad set names**, which carry the strategist's
name; see `NAMING.md` for the attribution rules.

## Users
- **Founder / media buyer**: account health, pod comparison, scaling decisions.
- **Creative strategists (pod leads)**: their pod's hit rate, winners, what to iterate.
- **Editors**: their own ads' performance; tagging their ads.

## Targets (configurable in Settings)
| | Value |
|---|---|
| Target CPA | $14 |
| Target ROAS | 1.7 |
| Hit | A new concept reaches CPA ≤ $14 **and** ROAS ≥ 1.7 over its first 3 days of spend |
| Min test spend | $100 (proposed, pending confirmation) |

## v1 scope (Phases 0–2)
- **Dashboard**: KPIs (Meta), pod leaderboard, top ads, alerts.
- **Ad Rankings**: Ads / Pods / Editors tabs; rank by spend, purchases, ROAS, CPA, CTR;
  filters for pod, status, search; date range (week / month / all / custom). Detail panel with
  preview, pod/editor/tags, results across all copies, daily charts, list of copies.
- **Needs Tagging**: unattributed ads by spend, with suggested pod and bulk tagging.
- **Naming Tool**: generates standard names; checks any existing name.
- **Settings**: targets, pods and editors, data-source connections and sync status.

## Later
Creative Insights (by angle/format/hook, AI write-ups) → fatigue analytics. (Triple Whale was
added in Phase 4 and removed in Oct 2026.)

## Non-goals for v1
- No changes to campaigns, automated or approved: the hub is read-only on Meta (`ads_read`). Ad management stays in Ads Manager.
- No native app; responsive web only.
