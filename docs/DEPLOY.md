# Deploying: preview first, then live

| Branch | Goes to | Database | Command (Workers Builds) |
|---|---|---|---|
| `main` | the live hub, kojeva-hub.<account>.workers.dev | `kojeva-hub` (real data) | `npm run deploy` |
| any other branch | the preview, kojeva-hub-preview.<account>.workers.dev | `kojeva-hub-preview` (sample data) | `npm run deploy:preview` |

Changes are pushed to a branch, checked on the preview, and go live only when the branch is merged
into `main`. If a live deploy breaks something, roll back in Workers & Pages → kojeva-hub →
Deployments.

## The preview
- Its own Worker (`env.preview` in `wrangler.jsonc`) and database, so testing never touches real
  numbers or tags. No Meta secrets (it can't connect to Meta), no nightly sync, no Atria ingest.
- `scripts/seed-preview.ts` loads the sample data only while the preview database has no posts:
  D1 writes are shared across the account (free plan: 100k rows/day), so it isn't reseeded on
  every push. To reset it, empty `posts` in the preview database and push again.
- The vite build bakes the config in, so the preview build runs with `CLOUDFLARE_ENV=preview`.
- It sits behind the same Cloudflare Access sign-in (an Access application for its hostname).

## Guards
- The preview build refuses to serve the live address (`HUB_ENV`, `worker/index.ts`): if it ever
  lands on kojeva-hub, every API call says so instead of showing sample data. That happened once
  (Oct 21): Cloudflare's "Builds for Preview branches" on the live Worker deploy onto the live
  Worker whatever name the config gives. Keep that setting off on kojeva-hub.
- `scripts/deploy-guard.ts` stops the live deploy on any branch but main, and the preview deploy
  on main (Workers Builds sets `WORKERS_CI_BRANCH`).

## One-time setup (Cloudflare dashboard)
1. kojeva-hub → Settings → Build: production branch `main`; Previews Base → Builds for Preview
   branches **off**.
2. Storage & Databases → D1: `kojeva-hub-preview` (its ID is in `wrangler.jsonc`).
3. A separate Worker for the preview: Workers & Pages → Create → Import a repository →
   `digitalbizcoms0024-png/kojeva-app`, name `kojeva-hub-preview`, production branch
   `claude/affectionate-cannon-rltll0` (the branch changes are made on), build command empty,
   deploy command `npm run deploy:preview`. Leave its preview-branch builds off.
4. Zero Trust → Access → Applications → Kojeva Hub → Destinations → Add Workers:
   `kojeva-hub-preview`, "A Worker's production and preview URLs".
