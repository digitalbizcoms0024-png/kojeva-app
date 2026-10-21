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

## One-time setup (Cloudflare dashboard)
1. Workers & Pages → kojeva-hub → Settings → Build: production branch `main`.
2. Storage & Databases → D1 → Create database `kojeva-hub-preview`; its ID goes in
   `wrangler.jsonc` (`env.preview.d1_databases[0].database_id`).
3. Same Build settings: enable builds for non-production branches, deploy command
   `npm run deploy:preview`.
4. Zero Trust → Access → Applications: add `kojeva-hub-preview.<account>.workers.dev` to the
   Kojeva Hub application (same policies).
