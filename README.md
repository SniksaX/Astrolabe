# Astrolabe

Personal document assistant: paste a PDF, DOCX, web page, or YouTube video, then ask questions with **citations that point to the exact source passage**.

Thesis project (RNCP 38606). Monorepo — one Express API process (modules, not microservices), a Next.js web app, Postgres + pgvector, and an OpenAI-compatible inference provider.

## Stack

| Layer | Tech |
| --- | --- |
| Web | Next.js (App Router), Tailwind CSS v4, shadcn/ui |
| API | Express, TypeScript — modules `auth`, `ingestion`, `retrieval`, `generation` |
| Data | Postgres 16 + pgvector, row-level security (`owner_id`) |
| Inference | OpenAI-compatible client in `packages/inference` (`embed`, `score`, `stream`, `transcribe`) |

## Repository layout

```
apps/web          Next.js UI (marketing, auth, dashboard shell)
apps/api          Express HTTP server + ingestion worker
packages/         shared-types, config-core, db-core, inference
infra/migrations  SQL migrations (applied once, never edited after apply)
```

## Prerequisites

- Node.js 22+ and npm
- Docker (local Postgres)
- An OpenAI-compatible inference endpoint (embeddings + chat), when testing AI features

## Quick start

```bash
# 1. Install
npm install

# 2. Environment
cp .env.example .env
# Fill JWT_SECRET and inference URLs as needed

# 3. Database
docker compose up -d
npm run migrate

# 4. Run (separate terminals)
npm run dev -w @astrolabe/api          # http://localhost:4000
npm run worker -w @astrolabe/api       # ingestion queue poller
npm run dev -w @astrolabe/web          # http://localhost:3000
```

Optional local user:

```bash
npm run seed:dev-user -w @astrolabe/api
```

## Scripts (root)

| Command | Purpose |
| --- | --- |
| `npm run build` | Build packages, then API and web |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run test` | Run workspace tests |
| `npm run migrate` | Apply `infra/migrations` via db-core |

## Current scope (J2)

**In place:** auth (signup/login/session/refresh/lockout), dashboard shell, public + auth pages, ingestion extractors + chunker, inference package, CI with an accessibility gate.

**Still stubbed or later:** full ingestion queue wiring, hybrid retrieval, streaming generation with citations, voice, billing, RGPD export/delete.

## License

Private thesis project — not licensed for redistribution.
