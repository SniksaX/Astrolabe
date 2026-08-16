# Astrolabe

**Astrolabe** is a personal document assistant. You bring a source (PDF, DOCX, web page, or YouTube video), ask questions about it, and get answers with **citations that point to the exact passage**.

This repository is a thesis project for the **RNCP 38606** certification (French vocational degree). The product name is **Astrolabe**, including the local Postgres role, password, database, and Docker volume.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [API surface](#api-surface)
- [Web routes](#web-routes)
- [Data & security model](#data--security-model)
- [Inference](#inference)
- [CI](#ci)
- [Project status & milestones](#project-status--milestones)
- [Development conventions](#development-conventions)
- [License](#license)

---

## What it does

| Capability | Description |
| --- | --- |
| Multi-format sources | PDF, DOCX, HTML/web pages, YouTube (extractors live under ingestion) |
| Q&A with citations | Answers grounded in retrieved chunks, with citations to the source passage |
| Auth & sessions | Signup / login, HttpOnly cookies, access JWT + rotating refresh tokens, lockout |
| Dashboard shell | Authenticated UI: sidebar, status bar, mobile nav, chat empty state, sources screens |
| Configurable LLM | OpenAI-compatible provider: local in dev, EU-hosted in production |
| Planned | Voice interaction, freemium multi-account via Stripe, RGPD export/delete |

---

## Architecture

Monorepo (`npm` workspaces). A single Express API process, organized as modules. Each module exposes a public `index.ts`; cross-module imports go through that surface only.

```text
┌─────────────┐     cookie session      ┌──────────────────────────────┐
│  apps/web   │ ───────────────────────►│  apps/api (Express)          │
│  Next.js    │◄───────────────────────│  auth · ingestion · retrieval │
│  :3000      │     JSON / SSE          │  generation · conversations  │
└─────────────┘                         │  + worker.ts (ingest poller) │
                                        └──────────────┬───────────────┘
                                                       │
                         ┌─────────────────────────────┼─────────────────────────────┐
                         ▼                             ▼                             ▼
              packages/db-core              packages/inference                 Postgres 16
              pool · migrate · RLS          embed · score · stream ·           + pgvector
                                            transcribe                         :5433
```

| Piece | Role |
| --- | --- |
| `apps/web` | Next.js App Router: marketing (SSG), auth pages, dashboard shell |
| `apps/api` | Express HTTP (`server.ts`) + ingestion worker (`worker.ts`) |
| `packages/shared-types` | Cross-boundary types (`Chunk`, `Citation`, `Document`, `ChatRequest`, …) |
| `packages/config-core` | Fail-fast env helpers (`requireEnv`, `requireSecret`, …) |
| `packages/db-core` | `pg` pool, migration runner, `withUserScope` / `withReadOnlyUserScope` |
| `packages/inference` | LLM provider client (`embed`, `score`, `stream`, `transcribe`) |
| `infra/migrations` | Ordered SQL migrations (filename-tracked, applied once) |

---

## Repository layout

```text
Astrolabe/
├── apps/
│   ├── api/                 Express API + worker
│   │   └── src/modules/     auth, conversations, generation, ingestion, retrieval
│   └── web/                 Next.js UI
│       ├── app/             (marketing), (dashboard), login, inscription
│       └── components/      shell, chat, ui (shadcn)
├── packages/
│   ├── shared-types/
│   ├── config-core/
│   ├── db-core/
│   └── inference/
├── infra/migrations/        000 → 090_rls (extensions, auth, ingestion, chat, RLS)
├── .github/workflows/       CI (typecheck, build, Vitest, axe-core)
├── docker-compose.yml       Postgres + pgvector
├── .env.example             Blueprint for local `.env`
└── package.json             Workspaces + root scripts
```

Local-only (gitignored): `docs/` (journal, ADRs, wireframes, MPD), `.env`, `.data/`, `node_modules/`, build outputs.

---

## Prerequisites

- **Node.js 22+** and **npm**
- **Docker** / Docker Compose (Postgres + pgvector)
- An **OpenAI-compatible** inference stack when exercising AI paths:
  - embeddings (`/v1/embeddings`)
  - chat completions (generation)
  - optional TEI `/rerank` or judge model (ADR 0004)

---

## Quick start

```bash
# 1. Clone & install
git clone git@github.com:SniksaX/Astrolabe.git
cd Astrolabe
npm install

# 2. Environment
cp .env.example .env
# Required for auth: set JWT_SECRET, e.g.
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# Set EMBEDDING_* / INFERENCE_* when you need AI features.

# 3. Database
docker compose up -d
npm run migrate

# 4. Dev processes (three terminals)
npm run dev -w @astrolabe/api          # HTTP API  → http://localhost:4000
npm run worker -w @astrolabe/api       # ingestion queue poller
npm run dev -w @astrolabe/web          # Next.js   → http://localhost:3000
```

Health check:

```bash
curl -s http://localhost:4000/health
# {"status":"ok"}
```

Optional seeded user:

```bash
npm run seed:dev-user -w @astrolabe/api
```

Open [http://localhost:3000](http://localhost:3000) (landing), [http://localhost:3000/inscription](http://localhost:3000/inscription), or [http://localhost:3000/login](http://localhost:3000/login).

---

## Environment variables

Copy from [`.env.example`](.env.example). Summary:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (default host port **5433**) |
| `PORT` | API port (default `4000`) |
| `WEB_ORIGIN` | Exact CORS origin for credentialed cookies (`http://localhost:3000`) |
| `JWT_SECRET` | HS256 signing secret (**required**, fail-closed) |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Token claims |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | Session lifetimes (`15m` / `30d` by default) |
| `ARGON2_*` | Password hashing cost parameters |
| `LOCKOUT_MAX_ATTEMPTS` / `LOCKOUT_WINDOW_MINUTES` | Brute-force lockout |
| `EMBEDDING_API_URL` / `EMBEDDING_MODEL` / `EMBEDDING_MODEL_DIM` | Embedding provider |
| `USE_EXTERNAL_AI` | Master switch for score + stream |
| `INFERENCE_API_URL` / `INFERENCE_API_KEY` / `INFERENCE_MODEL_*` | Chat (+ optional judge) |
| `RERANKER_API_URL` / `RERANK_ENABLED` / `FUSION_METHOD` | Retrieval rerank / fusion |
| `UPLOAD_DIR` | Local upload storage for PDF/DOCX bytes |
| `NEXT_PUBLIC_API_URL` | Browser → API base URL |

Never commit `.env`. Local Postgres credentials are `astrolabe` / `astrolabe` / database `astrolabe` (see `docker-compose.yml`).

---

## Scripts

### Root

| Command | Purpose |
| --- | --- |
| `npm run build:packages` | Build shared packages |
| `npm run build` | Packages + API + web |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run test` | Vitest across workspaces |
| `npm run migrate` | Apply `infra/migrations` (tracked in `schema_migrations`) |

### API (`@astrolabe/api`)

| Command | Purpose |
| --- | --- |
| `npm run dev -w @astrolabe/api` | HTTP server with reload |
| `npm run worker -w @astrolabe/api` | Ingestion worker with reload |
| `npm run build -w @astrolabe/api` | Compile to `dist/` |
| `npm run seed:dev-user -w @astrolabe/api` | Insert a local dev user |

### Web (`@astrolabe/web`)

| Command | Purpose |
| --- | --- |
| `npm run dev -w @astrolabe/web` | Next.js dev server |
| `npm run build -w @astrolabe/web` | Production build |
| `npm run test -w @astrolabe/web` | Unit tests (Vitest) |
| `npm run test:a11y -w @astrolabe/web` | Playwright + axe-core accessibility gate |

---

## API surface

Base URL (dev): `http://localhost:4000`

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `POST` | `/api/auth/signup` | Create account |
| `POST` | `/api/auth/login` | Session cookies |
| `POST` | `/api/auth/refresh` | Rotate refresh token |
| `POST` | `/api/auth/logout` | Clear session |
| `GET` | `/api/auth/me` | Current user (JWT) |
| `GET` | `/api/auth/me/export` | RGPD export (**stub**) |
| `DELETE` | `/api/auth/me` | Account delete (**stub**) |
| `GET/POST/PATCH/DELETE` | `/api/conversations…` | Conversation CRUD |
| `POST/GET/DELETE` | `/api/ingestion/documents…` | URL ingest, upload, list, get, delete |
| `POST` | `/api/retrieval/search` | Hybrid search (**stubbed service**) |
| `POST` | `/api/generation/chat` | Chat / streaming (**mostly stubbed**) |

Auth for protected routes: JWT from session cookie, validated by `requireJwt`.

---

## Web routes

| Route | Audience |
| --- | --- |
| `/` | Public landing (marketing) |
| `/login` | Login |
| `/inscription` | Signup |
| `/chat`, `/chat/[…conversationId]` | Authenticated chat (empty state built; full chat later) |
| `/sources`, `/sources/ajouter` | Document library / add source |
| `/offre` | Offer / billing placeholder |
| `/reglages` | Settings placeholder |

Dashboard routes sit behind Next.js middleware that expects a session cookie.

---

## Data & security model

- **Postgres 16 + pgvector** via `docker-compose.yml` (host port `5433`).
- **Migrations** live under `infra/migrations/`, applied once by filename. After apply, changes go in a new migration file.
- **RLS** is enabled and forced on user-owned tables. Policies compare `owner_id` (or `user_id` on `private_embedding_cache`) to `current_setting('app.user_id', true)`. Missing scope fails closed.
- **Passwords**: Argon2id. **Tokens**: HS256 JWT access + rotating refresh (see project ADRs in local `docs/`).
- **CORS**: exact `WEB_ORIGIN` + `credentials: true` so cookies work across `:3000` / `:4000`.

---

## Inference

All provider I/O goes through `packages/inference`:

| Method | Behaviour |
| --- | --- |
| `embed` | Fail-closed (throws) |
| `score` | Rerank / LLM-judge, fail-open (`null` on error) |
| `stream` | Chat generation: mid-stream failures yield `{ kind: 'error' }` |
| `transcribe` | Voice stub (milestone J4) |

---


## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pushes to `main` and on pull requests:

1. `npm ci`
2. Build shared packages
3. Monorepo typecheck
4. Build API + web
5. Unit tests (Vitest)
6. Playwright + **axe-core** accessibility audit on key pages

---

## Project status & milestones

### Current (J2, socle)

**Real:** auth end-to-end, dashboard shell, `/` / `/login` / `/inscription`, chat empty state, ingestion extractors + chunker, `packages/inference`, CI with a11y gate.

**Stubbed (`notImplemented`):** full `processJob` wiring, retrieval search, generation streaming, RGPD export/delete, embedding caches / queue internals.

**Not started:** `voice/`, `billing/`, `privacy/` modules; several MPD tables (`subscriptions`, `consent_log`, `voice_transcripts`, …).

### Calendar

| Milestone | Target | Focus |
| --- | --- | --- |
| **J2** | 2026-09-14 | Socle, migrations, RLS, auth, CI |
| **J3** | 2026-10-05 | Ingestion (4 formats), hybrid search, eval, privacy |
| **J4** | 2026-10-26 | Streaming generation, citations, voice, quotas |
| **J5** | 2026-11-16 | Frontend polish, public site, test-mode payment, audits |

---

## Development conventions

- Unfinished logic throws `notImplemented('Class.method')`.
- Fail behaviour is per-operation: embeddings and auth throw; rerank and query decomposition can degrade quietly.
- Chunk sizing uses character budgets (open-weight tokenizers vary).
- CSS: Tailwind v4, design tokens in `apps/web/app/tokens.css`.
- Import sibling modules via their `index.ts`.

---

## License

Private thesis project, not licensed for public redistribution.
