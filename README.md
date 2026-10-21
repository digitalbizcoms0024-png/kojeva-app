# Kojeva Hub

Internal tool that ranks Kojeva's Meta ads and scores the 4 creative pods (Harris, Dhia, Shameer, Ali) on spend, CPA, ROAS and hit rate.

**Status:** Phase 0. The app runs on sample data; the live Meta sync is Phase 1. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it locally

```bash
npm install
npm run db:reset:local   # create local DB + load sample data
npm run dev              # http://localhost:5173
```

## Deploys

Cloudflare Workers Builds deploys this repo on every push to the production branch
(`claude/affectionate-cannon-rltll0` for now). Deploy command: `npm run deploy:sample` until the
live Meta sync lands; it reseeds the database with sample data on every deploy. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deploying-cloudflare-workers-builds-auto-deploys-from-github).

## Preview without a server

`npm run build:preview` writes `dist-demo/kojeva-hub-preview.html`: one self-contained page that runs
the real API code in the browser against SQLite (sql.js) loaded with the sample data. That's what the
claude.ai preview link is built from.

## Docs
- [PRD](docs/PRD.md): what we're building and why
- [Roadmap](docs/ROADMAP.md): phases and acceptance criteria
- [Architecture](docs/ARCHITECTURE.md): Cloudflare setup, data model, integrations
- [Naming](docs/NAMING.md): the ad-naming convention and how legacy names are parsed
- [Metrics](docs/METRICS.md): exact definitions of CPA, ROAS, hit rate, etc.
- [Design](docs/DESIGN.md): visual rules, colors, charts
