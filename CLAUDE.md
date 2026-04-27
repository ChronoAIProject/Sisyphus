# CLAUDE.md — Sisyphus

## Tech Stack

TypeScript across the board, two independent npm packages.

- **Backend (`sisyphus-api`):** Node.js 22, Express 5, TSOA (decorators → OpenAPI + routes), MongoDB driver, ws, node-cron, Pino, Ajv (JSON-schema), js-yaml. Tests: Vitest + supertest + mongodb-memory-server.
- **Frontend (`sisyphus-web`):** React 19, Vite, react-router 7, reactflow, react-force-graph (2D + 3D + three.js), CodeMirror, dnd-kit, react-markdown + remark-gfm, lucide-react, Tailwind CSS 3, dagre. Auth via `@nyxids/oauth-core` + `@nyxids/oauth-react` (linked from local NyxID checkout).
- **Database:** MongoDB 6+ (single DB `sisyphus`, six domain collection groups).
- **PDF compile:** `tectonic` (LaTeX engine, baked into the api Docker image).

## Architecture

```
Sisyphus/
├── sisyphus-api/                Single backend service (was 6 microservices, now consolidated).
│   ├── src/
│   │   ├── app.ts / index.ts / db.ts / types.ts
│   │   ├── health/              GET /health
│   │   ├── admin/               /audit, /settings
│   │   ├── ingest/              /ingest, /ingest/history (+ chrono-graph-client)
│   │   ├── papers/              /papers/compile (LaTeX → PDF via tectonic)
│   │   ├── runner/              /runs/{type}/{start|stop|status}, /runs/history (+ ws-server, sse-parser, aevatar-client, verify cron)
│   │   ├── schemas/             /schemas, /validate, /validate/{name}
│   │   └── workflows/           /workflows, /workflows/compile, /workflows/deploy, /connectors (+ ornn-client, mainnet-client, reference-resolver)
│   └── test/<same per-domain layout>
└── sisyphus-web/                React SPA. Talks to sisyphus-api through the NyxID proxy.
    └── src/
        ├── api/                 One client per domain (graph, ingestor, ornn, runner, schemas, workflow). All sisyphus-* clients use SERVICE='sisyphus-api'.
        ├── auth/                NyxID OAuth (PKCE)
        ├── components/          Per-domain pages and shared layout
        ├── hooks/               use-api, use-graph-data, use-research-stream, use-runner-websocket
        └── services/            Higher-level orchestration over api/
```

- All configurable values come from environment variables. Zero hardcoded config.
- Single MongoDB connection across all six domains. DB name `sisyphus` (configurable via `DB_NAME`).
- WebSocket server (runner) attaches to the same HTTP server as the REST routes.
- TSOA generates `src/generated/{routes.ts,swagger.json}` from controller decorators on every build — never edit them by hand; they are gitignored.

## API Surface

26 routes, all registered through TSOA. Browse them at `GET /docs` (Swagger UI) or `GET /openapi.json`.

| Domain | Routes |
|---|---|
| Health | `GET /health` |
| Admin | `GET/POST /audit`, `GET/PUT /settings` |
| Ingest | `POST /ingest`, `GET /ingest/history(/{uploadId})` |
| Papers | `POST /papers/compile` |
| Runner | `POST /runs/{workflowType}/{start\|stop}`, `GET /runs/{workflowType}/status`, `GET /runs/status`, `GET /runs/history(/{sessionId})` |
| Schemas | `GET/POST /schemas`, `GET/PUT/DELETE /schemas/{id}`, `POST /validate`, `POST /validate/{name}` |
| Workflows | `GET/POST /workflows`, `GET/PUT/DELETE /workflows/{id}`, `GET /workflows/{id}/deployment-status`, `POST /workflows/compile/{id}`, `POST /workflows/deploy/{id}` |
| Connectors | `GET/POST /connectors`, `GET/PUT/DELETE /connectors/{id}`, `POST /connectors/sync`, `GET /connectors/{id}/compile` |

## External Runtime Dependencies

`sisyphus-api` is designed to be deployed **behind NyxID** — the browser never reaches the API directly. Path: `browser → NyxID proxy → sisyphus-api`. The `serviceSlug` registered with NyxID must be `sisyphus-api`.

| Dependency | Purpose | Used by |
|---|---|---|
| **MongoDB** | Primary data store (one DB, all collections) | every domain |
| **NyxID** | Auth + proxy in front of sisyphus-api | all browser → api traffic |
| **chrono-graph** | Knowledge-graph store (red/blue/black nodes + edges) | ingest, runner |
| **chrono-storage** | S3-style blob store for compiled PDFs | papers |
| **chrono-ornn** | Skill prompt resolution (`/skill-xxx` references in workflow YAML) | workflows compile |
| **Aevatar mainnet** | Workflow execution + deploy target | runner, workflows deploy |
| **tectonic** | LaTeX → PDF | papers compile (Dockerfile installs it) |

`@nyxids/oauth-core` and `@nyxids/oauth-react` are pulled from a local NyxID checkout via `file:../../NyxID/sdk/{oauth-core,oauth-react}`. The repo expects `NyxID/` to be a sibling of `Sisyphus/` under the same parent directory.

## Code Standards

- TypeScript strict mode. Decorators enabled (TSOA needs `experimentalDecorators` + `emitDecoratorMetadata`).
- Logging via Pino. `info` for lifecycle events, `debug` for detailed flow, `error` for failures with structured context. Logs MUST NOT contain plaintext secrets — mask or redact.
- No hardcoded secrets, credentials, API keys, tokens in code — ever. Use env vars.
- Validation: TSOA does request-shape validation from controller types. JSON-schema validation goes through `/validate` (Ajv).
- Tests: Vitest for both packages. Backend tests boot the full app via `import("../../src/index.js")` and use `mongodb-memory-server`. Currently each test suite spins up its own server — colocating them or sharing a setup file is a follow-up.
- Keep code simple. Fewer lines > more abstractions. The recent merge intentionally kept each domain self-contained instead of inventing shared layers.

## Local Development

### Prereqs

- Node.js 22+ and npm.
- MongoDB running locally (`brew install mongodb-community`, `brew services start mongodb-community`).
- The NyxID monorepo checked out as a sibling of `Sisyphus/` (i.e. `~/code/work/NyxID/`). The frontend `package.json` and `vite.config.ts` reference `../../NyxID/sdk/{oauth-core,oauth-react}` — both SDKs must be `npm install`-ed and `npm run build`-ed once before installing the web package.
- Optional, only needed if you exercise the corresponding feature: `tectonic` (papers compile), running chrono-graph / chrono-storage / chrono-ornn / Aevatar mainnet (those domains).

### First-time setup

```bash
# 1. Build the local NyxID SDKs (the web package depends on their dist/).
(cd ../NyxID/sdk/oauth-core  && npm install && npm run build)
(cd ../NyxID/sdk/oauth-react && npm install && npm run build)

# 2. Install backend.
cd sisyphus-api
cp .env.sample .env       # then fill in values
npm install
npm run build             # generates src/generated/{routes.ts,swagger.json} + dist/

# 3. Install frontend.
cd ../sisyphus-web
cp .env.sample .env       # then fill in values
npm install
```

### Running

```bash
# Terminal 1 — backend (port 8080)
cd sisyphus-api && npm run dev

# Terminal 2 — frontend (port 5173)
cd sisyphus-web && npm run dev
```

`sisyphus-api` listens on `:8080` by default and connects to MongoDB at `mongodb://localhost:27017`. `sisyphus-web` runs Vite on `:5173` with proxy rules for `/nyxid`, `/proxy`, and `/aevatar-api` (see `vite.config.ts`).

### Env vars

See `sisyphus-api/.env.sample` and `sisyphus-web/.env.sample` for the full lists with defaults.

Backend essentials: `PORT`, `MONGO_URI`, `DB_NAME`, `CHRONO_GRAPH_URL`, `GRAPH_ID`, `CHRONO_STORAGE_URL`, `CHRONO_ORNN_URL`, `AEVATAR_API_URL`, `SCOPE_ID`, `VERIFY_CRON_INTERVAL_HOURS`, `EVENT_TTL_DAYS`.

Frontend essentials: `VITE_NYXID_PROXY_URL`, `VITE_NYXID_BASE_URL`, `VITE_NYXID_CLIENT_ID`, `VITE_AEVATAR_API_URL`, `VITE_DEFAULT_GRAPH_ID`.

### Known follow-ups

These were carried over from the pre-merge microservices and are worth cleaning up next:

- `WORKFLOW_SERVICE_URL` and `SCHEMA_SERVICE_URL` (in `runner/aevatar-client.ts` and `workflows/reference-resolver.ts`) used to point at sibling microservices. After the merge they can be replaced with direct in-process calls — currently they default to `http://localhost:8080`, i.e. the same process loops back to itself over HTTP.
- `sisyphus-web/src/api/runner-api.ts` references a few endpoints that don't exist on the backend (e.g. `GET /runs/{runId}`, `GET /runs/{runId}/events` for SSE). These were broken pre-merge; not regressions from this consolidation.
- Backend tests each boot the entire app via `import("../../src/index.js")`, which now also starts the WebSocket server and the verify cron. Suites should share a setup file or be refactored to import `app.ts` directly and call `connectDb()` explicitly.
- `schemas/validate.test.ts` imports `../../../workflows/schemas/*.json` — those files were never copied over from the upstream aevatar repo.

## Local Kubernetes Deployment

Sisyphus runs alongside ornn in **one shared local cluster**, namespace `ornn-cluster`. The chrono-ornn repo already provisions the bulk of the dependency stack (mongodb, minio, nyxid-backend, nyxid-frontend, chrono-storage, ornn-api), so sisyphus's `deployment/` only adds the bits ornn doesn't have:

```
deployment/
├── .env.sample.sisyphus              → copy to .env.sisyphus
├── sisyphus-api/                     (configmap, secret, deployment, service)
├── sisyphus-web/                     (deployment, service, ingress)
└── dependencies/
    ├── .env.sample.dependencies      → copy to .env.dependencies
    └── chrono-graph/                 (configmap, deployment, secret, service)
                                      — sisyphus-only; needs an external Neo4j (Aura or self-hosted)
```

For everything else, follow `chrono-ornn/CLAUDE.md` first to bring up the shared stack in `ornn-cluster`. Once that's running, sisyphus references the existing in-cluster Services by name (`mongodb`, `chrono-storage`, `ornn-api`, `nyxid-backend`, etc.).

### Service dependency layering (after ornn is already deployed)

```
Provided by ornn:  mongodb, minio, nyxid-backend, nyxid-frontend,
                   chrono-storage, ornn-api
Added by sisyphus: chrono-graph    → external Neo4j
                   sisyphus-api    → mongodb, chrono-graph, chrono-storage,
                                     ornn-api, nyxid-backend,
                                     aevatar (external, optional)
                   sisyphus-web    → sisyphus-api (proxied through nyxid-backend)
```

### Step 1 — Bring up the shared ornn stack

In the chrono-ornn repo: follow its `CLAUDE.md`, create namespace `ornn-cluster`, deploy `mongodb`, `minio`, `nyxid-backend`, `nyxid-frontend`, `chrono-storage`, `ornn-api`. Sisyphus reuses every one of those Services.

### Step 2 — Build chrono-graph image

```bash
# From a local chrono-graph checkout (sibling repo)
(cd ../chrono-graph && docker build -t chrono-graph:latest .)
```

### Step 3 — Deploy chrono-graph (sisyphus's only extra dep)

```bash
set -a; source deployment/dependencies/.env.dependencies; set +a
VARS=$(grep -hv '^#' deployment/dependencies/.env.dependencies | grep '=' | cut -d= -f1 | sed 's/^/$/g' | tr '\n' ',')
for f in deployment/dependencies/chrono-graph/*.yaml; do
  envsubst "$VARS" < "$f" | kubectl apply -f -
done
```

### Step 4 — Capture minio ClusterIP

```bash
# sisyphus-api needs it to resolve presigned-URL hostname `minio.ornn-cluster.local`
kubectl get svc minio -n ornn-cluster -o jsonpath='{.spec.clusterIP}'
```

Put that value in `deployment/.env.sisyphus` as `MINIO_HOST_ALIAS_IP`.

### Step 5 — Build sisyphus images

```bash
# Backend — context is sisyphus-api/ itself
docker build -t "${SISYPHUS_API_IMAGE}" sisyphus-api/

# Frontend — context is the parent directory so the Dockerfile can reach
# both Sisyphus/sisyphus-web/ and the local NyxID/sdk/ checkouts.
# Make sure sisyphus-web/.env is filled before building (VITE_* env vars
# are baked into the bundle at build time).
cd ..
docker build -t "${SISYPHUS_WEB_IMAGE}" -f Sisyphus/sisyphus-web/Dockerfile .
cd Sisyphus
```

### Step 6 — Deploy sisyphus

```bash
set -a; source deployment/.env.sisyphus; set +a
VARS=$(grep -hv '^#' deployment/.env.sisyphus | grep '=' | cut -d= -f1 | sed 's/^/$/g' | tr '\n' ',')
for dir in sisyphus-api sisyphus-web; do
  for f in deployment/$dir/*.yaml; do
    envsubst "$VARS" < "$f" | kubectl apply -f -
  done
done
```

### Verify

```bash
kubectl get pods -n ornn-cluster
curl -fsS http://sisyphus-api.ornn-cluster.svc.cluster.local:8080/health
```

### Env files

- `deployment/.env.sample.sisyphus` — sisyphus-api + sisyphus-web config. Copy to `.env.sisyphus`.
- `deployment/dependencies/.env.sample.dependencies` — chrono-graph config. Copy to `.env.dependencies`.

### Skipping optional features

sisyphus-api boots even if some downstream dependencies are unreachable — only the corresponding endpoints fail at runtime. Skip `chrono-graph` when not using `/ingest` or `/runs/*`, leave `AEVATAR_API_URL` blank when not using `/runs/*` or `/workflows/deploy`.

## Git Rules

- **Never** include `Co-Authored-By` lines in commit messages.
- **Never** auto-push without explicit user approval.
- **Never** force push.
- Single `.gitignore` at repo root only. Must ignore `.env`, `.env.*` (except `.env.sample` / `.env.sample.*`), `*.pem`, `*.key`, `credentials.json`, `node_modules/`, `dist/`, `sisyphus-api/src/generated/`.

## Branching Strategy

- **`main`** — Production release branch. Protected: no direct push, no force push, PRs only from `develop` or `release/*` (the latter only opened by the changeset-release bot).
- **`develop`** — Default branch and active development branch. Contains the latest CI-passing code. Protected: no direct push, no force push, PRs from any feature branch.
- **Workflow:** `feature/xxx` → PR → `develop` → PR → `main`.
- PR merge auto-deletes the source branch (protected branches excluded).
- **New work MUST branch from the latest `origin/develop`.** Every feature, bug fix, or any kind of change must start from a freshly fetched `develop` — either a new branch (`git fetch && git checkout develop && git pull && git checkout -b <name>`) or a new worktree created against `origin/develop`. Never branch off a stale local `develop` or another feature branch.

## Versioning & Releases

This project uses **Changesets** (`@changesets/cli`) for versioning.

- Both packages (`sisyphus-api`, `sisyphus-web`) share a unified version number (fixed mode).
- Each package has its own `CHANGELOG.md`, auto-generated with GitHub PR links.
- Release notes are published on [GitHub Releases](https://github.com/ChronoAIProject/Sisyphus/releases).

### During development

Every feature PR targeting `develop` MUST include a changeset:

```bash
npx changeset
```

Select affected package(s), semver bump level (`patch` / `minor` / `major`), write a short description. Commit the generated `.changeset/*.md` file with the PR. CI (`changeset-check.yml`) blocks PRs that don't include one — use `npx changeset --empty` for docs-only / CI-only PRs.

### Cutting a release

Fully automated on the `main` side. No local script to run — developer action is "open a PR, review a PR". `.github/workflows/changeset-release.yml` is a state machine driven by `push: main`.

**Step 1 — Promote `develop` → `main`.** Open a PR `develop → main` and merge it. Regular PR; it carries whatever features + unconsumed `.changeset/*.md` files have piled up on `develop` since the last release.

**Step 2 — Review the bot's release-bump PR.** On the `main` push from Step 1, the workflow sees pending `.changeset/*.md` files, so it:

1. Creates branch `release/v<next>` off `main`.
2. Runs `npm run version-packages` — consumes `.changeset/*.md`, bumps both `package.json` files, appends to each `CHANGELOG.md`.
3. Commits `chore: version packages → v<next>`, force-pushes the branch.
4. Opens PR `release/v<next> → main`.

Review that PR. Merge with **Squash and merge** (keeps history linear; `main` ends up with exactly one `chore: version packages → v<next>` commit).

**Step 3 — Tag + GitHub Release + sync back to `develop`.** On the `main` push from Step 2, the workflow sees no pending changesets + `sisyphus-api/package.json`'s version has no matching `v<version>` tag, so it:

1. Creates an annotated `v<version>` tag and pushes it.
2. Extracts the `## <version>` section from each package's `CHANGELOG.md`, builds a combined body, and calls `gh release create`.
3. Creates branch `sync/post-release-v<version>` from `main`.
4. Opens PR `sync/post-release-v<version> → develop` — **auto-approved + auto-merged** by the same workflow via a direct `PUT /repos/.../pulls/:n/merge` API call with `merge_method: merge`. No human action for the sync step; the PR is a deterministic replay of a commit that already passed CI on `main`.

**Load-bearing:** the sync PR **must** land as a merge commit, not a squash. A squash-merge creates an orphan commit on `develop` whose parent is the pre-bump `develop` tip, not `main`'s bump commit. Subsequent `develop → main` PRs then show a phantom version bump because `git merge-base` walks back past the orphan. A merge commit gives `develop` two parents (previous `develop` HEAD + `main`'s bump), making `merge-base(main, develop)` = `main`'s HEAD after the sync.

If branch protection blocks the auto-merge (e.g. stricter required-reviewer rules added later), the PR stays open with a warning log entry — **merge it manually via "Create a merge commit", never "Squash and merge"**.

### State summary (what the workflow does on every `main` push)

| pending `.changeset/*.md` | `v<version>` tag exists | action |
|---|---|---|
| > 0 | — | open `release/v<next> → main` |
| 0 | no | tag, create GH Release, open `sync/post-release-v<version> → develop` |
| 0 | yes | no-op (hotfix / docs / CI push without changeset) |

### Permissions

The workflow needs `contents: write` + `pull-requests: write`. At the org level, "Allow GitHub Actions to create and approve pull requests" must be enabled.

### Hotfixes directly to main

If something lands on `main` without a changeset (emergency patch), state is "0 pending + tag exists" → no-op. No version bump. When you're back on the normal flow, add a proper changeset-carrying PR through `develop` to stamp the next version.

## CI / required status checks

Every PR runs the `.github/workflows/ci.yml` jobs. Branch protection on `develop` and `main` requires the following before merge:

| Status check | Branch | Source |
|---|---|---|
| `typecheck` | both | `tsoa spec-and-routes` + `tsc --noEmit` on sisyphus-api |
| `test` | both | `vitest run` on sisyphus-api |
| `build` | both | `npm run build` on sisyphus-api |
| `gitleaks` | both | `gitleaks detect` against the PR diff |
| `docker-build` | both | `docker build sisyphus-api/` |
| `check-approval` | both | `require-review.yml` — collaborator gate |
| `check-changeset` | develop | every PR to develop must include a `.changeset/*.md` |
| `check-source-branch` | main | only `develop` or `release/*` may target `main` |

sisyphus-web typecheck/build is intentionally NOT in CI today — its `file:../../NyxID/sdk/...` deps need a sibling NyxID checkout that CI doesn't have. Verified locally before each release. Same for the sisyphus-web docker image.

## CODEOWNERS

`.github/CODEOWNERS` gates trust-critical paths to `@chronoai-shining` so a malicious PR can't loosen the gates and self-merge. Currently covers:

- `*` (default — every file needs maintainer review until we add team members)
- `/.github/workflows/`, `/.github/CODEOWNERS`
- `/.changeset/config.json` (fixed-linked package policy)
- `/package.json`, `/sisyphus-api/package.json`, `/sisyphus-web/package.json`
- `/sisyphus-api/Dockerfile`, `/sisyphus-web/Dockerfile`, `/sisyphus-web/nginx.conf`, `/deployment/`

For these rules to actually gate, branch protection must enable "Require review from Code Owners" — the `require-review.yml` workflow handles the trusted-author / collaborator carve-outs.

## GitHub Issue Rules

Issue tracker: https://github.com/ChronoAIProject/Sisyphus/issues

1. **All sisyphus work lives as GitHub issues.** Every feature, bug, and proposal MUST be created as an issue on the tracker above. Do NOT write proposals, task specs, or tracking docs under `docs/` — use issues.
2. **Default assignee:** every issue MUST be assigned to `chronoai-shining`.
3. **Title prefix:** every issue title MUST start with a category tag — one of `[Bug]`, `[Feature]`, `[CI/CD]`, `[Docs]`, `[Misc]`. Example: `[Feature] WebSocket reconnect with exponential backoff`.
4. **No duplicates.** Before creating a new issue, search the existing issue list. If duplicates are found, keep one and close the others with a comment `Duplicate of #N`.
5. **PR ↔ issue linkage:**
   - Every PR MUST tag the issue(s) it resolves in the PR body (use `Closes #123` / `Fixes #123`).
   - When the PR merges, all tagged issues MUST be closed.
   - If a PR solves something with no existing issue, create the issue first, then tag it in the PR.
6. **Cross-references:** when issues are related or have an execution order, add explicit references in the issue body (`Depends on #X`, `Blocks #Y`, `Related to #Z`).
7. **Milestones for large work:** any large feature or code change MUST have a milestone, and all related issues MUST be attached to it.
8. **Milestone deadlines:** every milestone MUST have a `due_on` date.
9. **Labels:** every issue MUST carry at least one topic label (e.g., `api`, `dx`, `security`, `infra`, `phase:N`) so the issue's domain is visible at a glance.
