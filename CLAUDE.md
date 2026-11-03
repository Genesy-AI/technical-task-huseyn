# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TinyEnginy is a take-home exercise: a leads management app. There are two independent pnpm packages, `backend/` and `frontend/`, with no root workspace, so run commands from inside each directory. Node v22 (see `.nvmrc`). 

## Commands

**Backend** (`cd backend`)
- `pnpm install && pnpm migrate:dev && pnpm gen:prisma`: one-time setup
- `temporal server start-dev`: Temporal dev server on `localhost:7233`. It must be running before the API starts, or the in-process worker crashes the process.
- `pnpm dev`: API on port 4000 (nodemon + ts-node). It also starts the Temporal worker.
- `pnpm migrate:dev`: run after any `prisma/schema.prisma` change. It creates a migration and regenerates the client.
- `pnpm build` / `pnpm format`
- `pnpm test`: Vitest. Run a single file with `pnpm test src/utils/messageGenerator.test.ts`, or filter by name with `pnpm test -t "name"`.

**Frontend** (`cd frontend`)
- `pnpm dev`: Vite dev server. It reads `VITE_API_URL` from `frontend/.env` (`http://localhost:4000`) and throws at startup if it is missing.
- `pnpm build`: `tsc -b && vite build`. Use it for type-checking.
- `pnpm lint`: ESLint with `--max-warnings 0`
- `pnpm test`: Vitest with jsdom and `src/test/setup.ts`. Run a single file with `pnpm test src/utils/csvParser.test.ts`.

## Architecture

### Backend (Express 5 + Prisma/SQLite + Temporal)
- `src/index.ts` holds the whole API: every `/leads` route, hand-rolled CORS, and the Prisma client. At the bottom it calls `app.listen(4000)` and `runTemporalWorker()`, so the API server and the Temporal worker run in **one process**.
- The SQLite DB is the committed file `prisma/dev.db` (the URL is hardcoded in `schema.prisma`; `.env.sample` is unused boilerplate). There is a single `lead` model.
- Temporal layout:
  - `src/worker.ts` registers the worker on task queue `myQueue`, namespace `default`.
  - `src/workflows/workflows.ts` holds workflow definitions. They run in Temporal's deterministic sandbox, so they may only call activities through `proxyActivities`; no I/O or Node APIs.
  - `src/workflows/activities/` holds the activities, where side effects belong. They are re-exported via `activities/index.ts` and passed to the worker as one object.
  - `workflowsPath` points to `src/workflows/index.ts`, so new workflows must be exported from there.
- `POST /leads/verify-emails` opens a new Temporal client connection per request. It runs `client.workflow.execute` sequentially for each lead and waits for the results synchronously inside the HTTP request.
- `src/utils/messageGenerator.ts` replaces `{fieldName}` placeholders using a hardcoded `availableFields` whitelist. It throws on unknown or empty fields. New lead fields must be added here to be usable in templates.

### Frontend (React 18 + Vite + TanStack Query + Tailwind v4)
- Typed API layer in `src/api/`:
  - `utils.ts` has `endpoint<Output, Input>(method, path | pathBuilder)`, which wraps axios. For GET, the input is sent as query params; for other methods it is the body.
  - `modules/leads.ts` declares all endpoints.
  - `types/leads/*.ts` holds one Input/Output type file per endpoint.
  - These types are hand-written mirrors of the backend; nothing is shared or generated. Keep them in sync manually, and note that some have already drifted (e.g. `update` uses `put`, while the backend route is `PATCH`).
- `mutations/useApiMutation.ts` is a typed registry of mutation options keyed by API path, e.g. `useApiMutation('leads.create')`. Most components call `useMutation` directly with `api.leads.*` instead.
- Query key convention: `['leads', 'getMany']`. Mutations invalidate this key to refresh the table.
- UI: `LeadsList.tsx` is the main table and toolbar. `CsvImportModal.tsx` uses `utils/csvParser.ts` (PapaParse, lowercased headers, per-row validation) and then calls `POST /leads/bulk`. `MessageTemplateModal.tsx` calls `POST /leads/generate-messages`.

### Adding a lead field touches every layer
`schema.prisma` (then `migrate:dev`) → the create, update and bulk handlers in `index.ts` → `messageGenerator.ts` `Lead` + `availableFields` → the frontend `api/types/leads/*` → `csvParser.ts` → the `LeadsList` columns → the template modal's field list.

## Reference material
`docs/` contains sample CSVs (valid, missing-field and error cases) for testing imports, plus UI wireframes (`ui-wireframes.png`).

## Strict rules
- Do not commit, stage or push into remote, without explicitly asked so
- When dealing with git, use gh cli
- Do not put api keys and secrets inside the files, other than gitignored .env file
- Be concise and short with your responses and be surgical with your changes, avoid unsolicited refactor