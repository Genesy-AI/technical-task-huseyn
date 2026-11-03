# Improvements & Technical Roadmap

Follow-ups found while fixing the email verification stall and from a codebase review (2026-11-03). Each item has a conventional-commit title so it can be picked up as a single PR.

**Priority scale**
- **P0:** user-facing bug or data-integrity risk. Do next.
- **P1:** reliability or scalability. Plan for the coming iterations.
- **P2:** developer experience and code health.

---

## P0

Ordered by impact: security and data exposure first, then resource mismanagement, then issues that lose leads or revenue. Findings marked *(verified)* were reproduced against the running API on 2026-11-03.

### Security and data exposure

### `fix(security): restrict CORS origin and bind the API to localhost`
*(verified)* The API sends `Access-Control-Allow-Origin: *` and answers every preflight, including `DELETE`, and it listens on all interfaces (`*:4000`). Any website a user visits can therefore read every lead with `GET /leads` (names and emails) and wipe them with `DELETE /leads`, straight from that user's browser. Anyone on the same network can do the same directly. Allow only the frontend origin (from env), and bind to `127.0.0.1` unless the API is deliberately exposed.

### `feat(security): require authentication on all /leads routes`
None of the routes have authentication or authorization, so anyone who can reach the API can read, change or delete every lead. Add session or token auth middleware in front of `/leads`, and scope leads to their owner or account before the app is deployed anywhere shared.

### `fix(api): add a global error handler and stop leaking stack traces`
*(verified)* `GET /leads/abc` returns a 500 HTML page with the Prisma error, the stack trace and absolute server paths (`/Users/.../backend/...`). The routes without `try/catch` (`POST /leads`, `GET/PATCH/DELETE /leads/:id`) fall through to Express's default error handler, which includes stack traces whenever `NODE_ENV` isn't `production`. Validate `:id` as a positive integer and return 400 if it isn't. Return 404 for missing leads (`GET /leads/999999` currently returns `200 null`). Add a JSON error handler that logs the details on the server and only sends a generic message to the client.

### `chore(security): stop tracking prisma/dev.db in git`
`backend/prisma/dev.db` is committed and holds every lead (currently 57). Any real data imported locally ends up in git history as soon as someone commits the DB, which a plain `git add .` will do. Untrack it (`git rm --cached`), add it to `.gitignore`, and set up local data with a seed script built from `docs/*.csv`. If real data was ever committed, purge it from git history.

### `fix(leads): validate and sanitize bulk import input`
`POST /leads/bulk` in `backend/src/index.ts` only checks that `firstName`, `lastName` and `email` are non-empty strings. Gaps:
- **Optional fields aren't type-checked:** a non-string `jobTitle`/`countryCode`/`companyName` makes `.trim()` throw, and the raw error message is echoed to the client. Whitespace-only values are stored as `""` instead of `null`.
- **No format checks:** `email` isn't validated as an email, and there are no length limits on any field. (`countryCode` is now checked against ISO 3166-1 alpha-2: invalid codes are stored as `null` and valid ones are uppercased.)
- **Dedup is broken:** the DB lookup is case-sensitive on trimmed names, but the skip key uses the *untrimmed* input, so `" John"` or `"john"` slip past an existing `John`. Duplicates within the same payload aren't caught either.
- **No batch size cap:** a large `leads` array builds one huge `OR` query (can exceed SQLite's variable limit) and inserts row by row.

Validate each lead with a zod schema (trim, empty → `null`, email format, ISO country code, max lengths), return per-row errors without leaking internal messages, dedupe on normalized keys (including within the batch), cap the array size, and insert with `createMany`. The single-lead create/update handlers should reuse the same schema.

### `fix(deps): patch vulnerable runtime dependencies`
`pnpm audit --prod` reports 29 issues in the backend (1 critical, 10 high) and 3 high in the frontend. Most are in build-time tooling under `@temporalio/worker`, such as webpack. The ones that matter at runtime:
- `body-parser` < 2.4.0, through `express.json`: a malformed compressed body can take the API down.
- `@grpc/grpc-js` < 1.13.6, through `@temporalio/client`: a malformed message can crash it.

`proxy-addr` (critical) only matters if `trust proxy` is turned on, which it isn't today. The frontend `follow-redirects` issues only affect axios in Node, not in the browser, and Dependabot PRs #2–#4 cover them. Bump `express` and the `@temporalio/*` packages, and add `pnpm audit --prod --audit-level=high` to CI.

### Resource mismanagement

### `fix(verify-emails): make verification workflow idempotent per lead`
Workflow IDs use `verify-email-${lead.id}-${Date.now()}`, so double-clicking or opening two tabs starts duplicate workflows for the same lead. Use `verify-email-${lead.id}` with `WorkflowIdConflictPolicy.USE_EXISTING`, so a second request attaches to the run already in flight.

### `fix(import): align CSV upload size limits between frontend and backend`
*(verified)* `express.json()` uses its default 100 KB limit, so a `POST /leads/bulk` body over that size gets a `413` and the whole import fails with the generic "Failed to import" toast. The frontend never applies its own `MAX_UPLOAD_FILE_SIZE` (2 MB, defined in `api/utils.ts` and never used), so it lets these files through. In practice, a CSV of a few hundred rows can't be imported at all. Set an explicit `express.json({ limit })` that matches the frontend's file size check, enforce that check in `CsvImportModal`, and send large files in batches.

### `perf(leads): paginate GET /leads and cap bulk operation sizes`
`GET /leads` returns the whole table in one response, and the table renders every row. `generate-messages`, `verify-emails` and `DELETE /leads` accept `ids` arrays of any length and work through them one at a time. Memory use, response time and SQLite lock time all grow with the number of leads. Add cursor pagination (plus server-side select-all, since you can't select rows that haven't loaded), and cap the size of ID arrays.

### Lost leads and revenue

### `fix(leads): confirm bulk delete and make deletes recoverable`
One click on **Delete** removes every selected lead at once, with no confirmation and no undo. "Select all" followed by Delete wipes the database. Add a confirmation dialog that shows the count, and switch to soft deletes (a `deletedAt` column plus an undo toast) so a mis-click doesn't lose the leads for good.

### `fix(import): deduplicate leads by email, not by name`
Bulk import treats leads as duplicates when their `firstName` and `lastName` match. Two different people named "John Smith" at different companies count as one, and the second is silently dropped, so it's a lost lead. The same person imported with a different spelling of their name is stored twice, so they get contacted twice. Deduplicate on normalized email instead (plus a unique index on `email`), and report the skipped rows to the user. This builds on the normalization fix in the bulk import item above.

### `fix(messages): clear or flag a stale message when regeneration fails`
When `generate-messages` fails for a lead (missing field or unknown placeholder), the lead keeps the message from an *earlier* template, and the table shows it as if it were current. Outreach can then go out with the wrong or outdated text. On failure, either clear `message` or store a `messageStatus`/`messageError` with a `messageGeneratedAt` timestamp, and show stale messages distinctly in the table.

### `fix(verify-emails): reset or flag stale verification status on failure`
When verification fails, the lead keeps its *previous* `emailVerified` value, so a lead verified long ago still shows ✅ after a failed re-check. Add a `verificationStatus` enum (`PENDING | VERIFIED | INVALID | FAILED`) plus a `verifiedAt` timestamp, and show `FAILED` distinctly in the table.

### `fix(api): align lead create/update contract between frontend and backend`
*(verified)* The two sides disagree on field names and methods:
- `POST /leads` reads `name`, but the frontend sends `firstName`, so every create from the UI returns `400 "firstName, lastName, and email are required"`.
- The frontend calls `PUT /leads/:id`, but the backend only exposes `PATCH /leads/:id`, and the CORS `Access-Control-Allow-Methods` header leaves out `PATCH`. Lead updates from the UI fail.
- Once the method is fixed, `PATCH` still reads `name` and writes `String(name)` and `String(email)` unconditionally. A partial update would store the literal string `"undefined"` as the lead's first name or email.

Use `firstName` on both sides, update only the fields that are present, validate them with the shared bulk schema, and allow `PATCH` in CORS.

### `feat(import): soft-warn on invalid country codes in CSV import`
The backend now quietly stores invalid country codes (e.g. `XXX`) as `null` and still imports the lead, so the user never learns the value was dropped. `frontend/src/utils/csvParser.ts` should check `countryCode` against the same ISO 3166-1 alpha-2 list. When the code is invalid, it should add a non-blocking **warning** (separate from the row's `errors`, so the row stays importable), and `CsvImportModal.tsx` should show it in the preview, e.g. "Invalid country code `XXX`, it will be imported empty". Optionally, the bulk response could also return the affected rows.

## P1

### `refactor(verify-emails): move verification to background jobs with status polling`
The HTTP request still stays open until every workflow finishes. With large selections or slow providers it will hit proxy or browser timeouts. Instead, the endpoint should start the workflows and return `202 Accepted` right away. The workflow (or an activity) writes its result to the DB, and the frontend polls `GET /leads` (or uses SSE) to show a per-row spinner and the final status. The phone-enrichment workflow needs this same pattern.

### `feat(verify-emails): cap concurrent workflow starts for large selections`
`Promise.allSettled` over N leads starts N workflows at once. Cap concurrency (e.g. `p-limit`), or start a single batch parent workflow, so that bulk selections don't flood Temporal or future rate-limited providers.

### `fix(temporal): use Connection.lazy for the shared client to avoid leaking gRPC channels`
`getTemporalClient()` in `backend/src/index.ts` caches `Connection.connect(...)` and clears the cache when it fails. Inside the SDK (`@temporalio/client/lib/connection.js`), `connect()` first creates the gRPC channel through `lazy()` and then calls `ensureConnected()`. If that call throws, the channel is never closed. So while Temporal is down, every verify request leaks one gRPC channel, and each of those requests also blocks for up to 10s (`connectTimeout`) before failing.

Replace it with one connection created synchronously:
```ts
const temporalClient = new Client({
  connection: Connection.lazy({ address: 'localhost:7233' }),
  namespace: 'default',
})
```
`lazy()` creates a single channel that connects on first use and reconnects by itself after outages. This removes the leak and the reset-on-failure logic. Requests during an outage then fail through the SDK's built-in gRPC retry interceptor (up to 10 attempts with backoff) instead of waiting for a fresh connection. Also close the connection on `SIGTERM` as part of a graceful shutdown.

### `fix(temporal): make verifyEmail activity cancellation-aware`
When the activity times out, its 20s `setTimeout` keeps running in the worker. Real activities should heartbeat and honour `Context.current().cancellationSignal`, so abandoned attempts release their resources.

### `refactor(temporal): run the worker as a separate process`
The API and the Temporal worker share one process (`index.ts` calls `runTemporalWorker()`). If Temporal is down at boot, the API crashes, and the two can't be scaled or deployed independently. Add a separate `worker` entrypoint and script.

### `refactor(temporal): centralize temporal config`
`localhost:7233`, namespace `default` and task queue `myQueue` are hardcoded in several places. Move them into one config module backed by env vars.

### `feat(leads-table): shift-click range selection and keyboard support`
Bulk selection in `frontend/src/components/LeadsList.tsx` only toggles one checkbox at a time (`handleSelectLead`), which is slow for large lists. Add:
- **Shift-click range select:** remember the last clicked row (the anchor). Shift-clicking another row selects or deselects every row between them, matching the anchor's new state. Read `shiftKey` from the click event, because the `onChange` event doesn't expose it.
- **Keyboard support:** arrow keys move a focused row (roving `tabIndex`), `Space` toggles it, `Shift+↑/↓` extends the selection, `Ctrl/Cmd+A` selects all and `Esc` clears the selection. Add `aria-selected` on rows and `aria-label`s on the checkboxes.

Use row IDs in the current display order for ranges, so they stay correct once sorting or filtering is added.

### `feat(leads-table): replace email status emojis with icons and a shared tooltip`
The email cell in `frontend/src/components/LeadsList.tsx` (~line 276) shows `❓` / `✅` / `❌` for `emailVerified`. Emojis render differently on each OS, look out of place in the UI, and give no hint of what they mean.
- **Icons:** use `@tabler/icons-react`, which is already a dependency (e.g. `IconHelpCircle` / `IconCircleCheck` / `IconCircleX`). Import each icon individually so it tree-shakes, and give each one a status color.
- **Tooltips:** explain each state ("Not verified yet", "Email verified", "Email invalid"), and later the verification time and `FAILED` state from the stale-status item.
- **Singleton tooltip:** render one tooltip at the app root, through a `TooltipProvider` context or event delegation on `data-tooltip` attributes. Hovering or focusing a trigger moves that single tooltip and updates its text. Don't mount a tooltip per cell, which would multiply DOM nodes and listeners by the row count. It should open on keyboard focus too, close on `Esc`, and link to its trigger with `aria-describedby`. Make it reusable for other icon-only controls.

## P2

### `feat(leads): reliable phone number validation and normalization`
Phone numbers are only loosely checked right now (`leadFieldValidators.ts` on both sides): digits plus `+ - ( ) .` and spaces, an optional `x`/`ext.` extension, and 7–15 digits. That accepts invalid numbers and stores them in whatever format they came in. Look into a dedicated library such as `libphonenumber-js` (Google's libphonenumber metadata). It can validate per country (using `countryCode` as the default region), normalize to E.164 for storage while keeping a display format, and detect the number type (mobile or landline). Weigh bundle size (the `min` vs `max` metadata builds) against accuracy, and consider validating only on the backend.

### `feat(templates): return human-readable labels for template fields`
`GET /leads/template-fields` returns bare keys (`yearsInRole`, `linkedIn`), and the template modal shows them as-is. Return `{ key, label, description? }` objects instead (e.g. `{ key: 'yearsInRole', label: 'Years in role' }`). The modal can then show labels while still inserting `{key}`, and search by both. A `type` field would also make type-aware formatting possible later.

### `test(verify-emails): add integration tests for the verify-emails route`
Cover partial failure, all-failed and timeout-plus-retry paths using `@temporalio/testing` (`TestWorkflowEnvironment` with time skipping).

### `fix(frontend): add emailVerified to optimistic lead in useApiMutation`
`pnpm build` fails type-checking: the optimistic `newLead` in `src/api/mutations/useApiMutation.ts` doesn't set `emailVerified`.

### `chore(frontend): migrate ESLint config to flat config`
`pnpm lint` fails because ESLint 9 no longer reads `.eslintrc.cjs`. Migrate it to `eslint.config.js`.

### `refactor(api): share request/response types between backend and frontend`
The frontend API types are hand-written mirrors of the backend and have already drifted (see the PUT/PATCH item). Generate them from a shared schema (zod or OpenAPI), or move them into a shared package.

### `refactor(shared): extract duplicated lead utilities into a shared package`
Lead validation logic is copy-pasted across packages and kept in sync by hand:
- **`leadFieldValidators.ts`:** `backend/src/utils/` and `frontend/src/utils/` hold identical copies (`isValidPhoneNumber`, `normalizeLinkedInUrl`, `isValidLinkedInUrl`, `parseYearsInRole`). The only thing keeping them aligned is a "Keep in sync" comment.
- **Email validation:** `isValidEmail` exists only in `frontend/src/utils/csvParser.ts`. The backend doesn't check email format at all, so the API accepts what the CSV import rejects.
- **Trim / empty-to-null sanitizing:** it's repeated inline for every field in the create, update and bulk handlers in `backend/src/index.ts`.

Add a root pnpm workspace with a `packages/shared` (e.g. `@tinyenginy/shared`) holding a single zod `leadSchema`, plus the field validators and normalizers built on it. The backend handlers, `csvParser.ts` and the frontend forms all import it. This removes the duplicate tests, guarantees the client and server agree, and is the natural base for the shared-types item above and the bulk-import validation item in P0.

---

## Feature plan: Enrich phone

Find a lead's phone number through a Temporal workflow that queries Orion Connect → Astra Dialer → Nimbus Lookup in sequence and stops at the first hit.

**Prerequisites:** build this on top of (or after) these PRs:
- [PR #7](https://github.com/Genesy-AI/technical-task-huseyn/pull/7) `feat(leads): add yearsInRole, phoneNumber and linkedIn fields`. It adds the `phoneNumber` column this feature writes to, plus `leadFieldValidators.ts`.
- [PR #5](https://github.com/Genesy-AI/technical-task-huseyn/pull/5) `fix(verify-emails): bound temporal retries…`. It is the reference for retry policies, the shared Temporal client, and `Promise.allSettled` error handling.

### Provider behaviour (probed live, 2026-11-03)

| | Orion Connect | Astra Dialer | Nimbus Lookup |
|---|---|---|---|
| Latency | ~4.2s | ~0.2s | 2–3.5s |
| Auth | header `x-auth-me` | header `apiKey` | query param `?api=` (a header returns `401`) |
| Required input | `fullName`, `companyWebsite` | `email` | `email`, `jobTitle` |
| Hit | `{"phone":"7576893806"}` | `{"phoneNmbr":"4991675700"}` | `{"phoneNmbr":9973500851,"countryCode":"ES"}` |
| Miss | (none observed) | `{}` **or** `{"phoneNmbr":null}` | (none observed) |
| Failures | random `500` (~25%) | none observed | random `500` (~12%) |
| Bad input / auth | `400 {"message":"Missing required input"}` / `401` plain text | `401 Unauthorized` (plain text) | `400` / `401` |

Pitfalls these results expose:
- **Nimbus differs from its docs.** The field is `phoneNmbr`, not `number`, and its value is a **number**, so leading zeros can be lost. Parse both keys.
- **Responses are not deterministic.** The same input returns a different phone on every call, so a retried attempt can't be compared with an earlier one. Persist the result exactly once, at the end of the workflow.
- **Numbers come back without a country code.** Only Nimbus returns one, and it is always `ES`. Normalize with `lead.countryCode` as the default region.
- **`lead` has no `companyWebsite`**, which Orion requires. Derive it from the email domain (skip free-mail domains like gmail or outlook), or add the field following the "Adding a lead field" path in `CLAUDE.md`. Decide before starting.
- **`jobTitle` is optional on leads.** When it's missing, skip Nimbus instead of calling it and getting a `400`.

### 1. `feat(enrichment): phone provider abstraction layer`
Location: `backend/src/providers/phone/`.

- **Shared interface.** Each provider is a small adapter, and the rest of the system only sees the unified result:
  ```ts
  interface PhoneProvider {
    name: 'orion' | 'astra' | 'nimbus'
    canHandle(lead: LeadSnapshot): boolean      // has the inputs this provider needs?
    buildRequest(lead: LeadSnapshot): { url: string; headers: Record<string, string>; body: unknown }
    parseResponse(json: unknown): { rawPhone: string | null; countryHint?: string }
  }

  type PhoneLookupResult =
    | { status: 'FOUND'; phone: string /* E.164 */; provider: ProviderName }
    | { status: 'NOT_FOUND' | 'SKIPPED'; provider: ProviderName }
  ```
- **One HTTP client** (`requestProvider`), shared by all adapters. It applies:
  - `AbortSignal` support;
  - status classification into typed errors:
    - `400` → `ProviderBadRequestError` (non-retryable);
    - `401`/`403` → `ProviderAuthError` (non-retryable);
    - `429` → `ProviderRateLimitError` (retryable, honours `Retry-After`);
    - `5xx` or network failure → `ProviderUnavailableError` (retryable);
  - safe parsing of non-JSON bodies (Astra's `401` is plain text).
- **Defensive parsing.** Validate each provider's response with a small zod schema. Coerce numbers to strings, and treat `undefined`/`null`/`""` as no phone.
- **One normalizer**, `normalizePhone(raw, countryHint)`. Use `libphonenumber-js` (see the P2 phone validation item) to return E.164 or `null`, falling back to `isValidPhoneNumber` from PR #7. A number that fails validation counts as `NOT_FOUND`, so bad data is never stored.
- **Config and registry.**
  - Base URLs and keys come from `backend/.env`: `ORION_API_KEY`, `ASTRA_API_KEY`, `NIMBUS_API_KEY` (documented in `.env.sample` without values). Keys are never hardcoded.
  - A provider registry (`providers/phone/index.ts`) exports the ordered list. That makes reordering or adding a provider a one-line change.

### 2. `feat(enrichment): enrich-phone Temporal workflow and API`
- **Schema** (`prisma/schema.prisma`, then `pnpm migrate:dev`):
  - add `phoneEnrichmentStatus` (`PENDING | RUNNING | FOUND | NO_DATA | FAILED`), `phoneEnrichedAt DateTime?` and `phoneSource String?`;
  - this avoids the stale-status problem described in P0 for email verification.
- **Activities** (`workflows/activities/enrichPhone.ts`, re-exported from `activities/index.ts`):
  - `lookupPhone(provider, lead)`:
    - calls the adapter;
    - passes `Context.current().cancellationSignal` to `fetch`, so a timed-out attempt really stops (the P1 cancellation pitfall);
    - heartbeats on the slow providers.
  - `savePhoneResult(leadId, result)`: the **only** DB write. It is idempotent: it updates `phoneNumber`, `phoneSource`, status and timestamp. Decide whether it may overwrite an existing manual `phoneNumber`; default is no.
  - `markEnrichmentStatus(leadId, status)`: sets `RUNNING` when the workflow starts.
- **Workflow** `enrichPhoneWorkflow(leadId)` in `workflows.ts`, exported from `workflows/index.ts`:
  - Use a separate `proxyActivities` per provider, so timeouts match the latency observed above:

    | Provider | `startToCloseTimeout` |
    |---|---|
    | Orion | 8s |
    | Astra | 2s |
    | Nimbus | 6s |

    All three share `retry: { maximumAttempts: 3, initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '10s', nonRetryableErrorTypes: ['ProviderBadRequestError', 'ProviderAuthError'] }`.
  - Loop over the registry order:
    - skip a provider when `canHandle` is false;
    - **return early on `FOUND`**;
    - when a provider runs out of retries, log it and move to the next provider, so one failure doesn't kill the chain.
  - When every provider misses, the result is `NO_DATA`. If every provider *failed* (none answered), it's `FAILED`.
  - Expose `defineQuery('progress')` → `{ currentProvider, attempted: ProviderName[] }` for live feedback.
- **Idempotency:**
  - workflow ID `enrich-phone-${leadId}`;
  - `workflowIdConflictPolicy: USE_EXISTING`, so a double click or a second tab attaches to the run already in flight;
  - `workflowIdReusePolicy: ALLOW_DUPLICATE_FAILED_ONLY`, so completed leads aren't re-enriched unless the user explicitly forces it.
- **API** in `src/index.ts`:
  - `POST /leads/enrich-phones { leadIds: number[] }`:
    - validates the input and sets the selected leads to `PENDING`;
    - starts the workflows with `client.workflow.start` through the shared PR #5 client, with concurrency capped by `p-limit`;
    - returns **`202 { started, alreadyRunning, errors }`** straight away. It does **not** wait for the results, which avoids the P1 open-request pitfall.
  - `GET /leads/:id/enrich-phone` (optional): queries the workflow's `progress` for the current provider.
  - `GET /leads` already returns the new status columns.
- **Rate limits (nice to have):**
  - **Now:** cap concurrent workflow starts, and treat `429` as retryable with a longer backoff.
  - **Later:** give each provider its own task queue and run a worker per queue with `maxTaskQueueActivitiesPerSecond`, so Temporal enforces each provider's limit globally across workers.

### 3. `feat(leads-table): enrich phone action with live progress`
- **API layer:**
  - `api/types/leads/enrichPhones.ts` (Input/Output);
  - an `enrichPhones` endpoint in `api/modules/leads.ts`;
  - the new status fields added to `getMany.ts`.
- **Toolbar** (`LeadsList.tsx`): an "Enrich phones" action for the selected leads.
  - Disable it while the request is in flight.
  - Show a toast: "Enriching N leads…", then "Started N, M already running".
  - Invalidate `['leads', 'getMany']` when the action is triggered.
- **Phone cell feedback:**
  - `PENDING`/`RUNNING`: a spinner plus "Trying {provider}…" (from the query endpoint, if implemented);
  - `FOUND`: the phone, with its source shown in a tooltip;
  - `NO_DATA`: muted "No data found";
  - `FAILED`: an error icon with a retry action.
  - Use `@tabler/icons-react` icons rather than emojis (see the P1 icons item).
- **Polling:** set `refetchInterval: 2000` on the leads query **only** while any lead is `PENDING`/`RUNNING`. Show a summary toast once all of them settle.

### 4. `test(enrichment): provider, workflow and route tests`
- **Provider unit tests** (Vitest, `fetch` mocked):
  - each adapter's `buildRequest`: auth in the header vs the query param, and body shape;
  - `parseResponse` against the recorded payloads above, including `{}`, `{"phoneNmbr":null}` and numeric `phoneNmbr`;
  - status → error-class mapping;
  - `normalizePhone` edge cases.
- **Workflow tests** (`@temporalio/testing`, `TestWorkflowEnvironment.createTimeSkipping()`, mocked activities):
  - Orion hit → Astra and Nimbus are never called;
  - fall-through to Nimbus;
  - all miss → `NO_DATA`;
  - Orion fails 3× and the chain continues;
  - a non-retryable `400` is not retried;
  - `canHandle` false → provider skipped;
  - a duplicate start with the same ID attaches to the existing run.
- **Route tests:**
  - `POST /leads/enrich-phones` returns `202`;
  - invalid `leadIds` → `400`;
  - partial start failures are listed in `errors`.
- **Frontend** (Vitest + Testing Library):
  - phone cell renders each status;
  - polling starts and stops correctly;
  - the toolbar action is disabled while pending.
