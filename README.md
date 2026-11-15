# Clinicle Intelligence

Clinicle Intelligence (CI) is a multi-tenant clinical operations application. This monorepo includes identity, tenant isolation, administration, communications, media, observability, testing, and deployment tooling.


| Layer       | Stack                                                               |
| ----------- | ------------------------------------------------------------------- |
| Backend     | FastAPI, SQLAlchemy, PostgreSQL (`be/` — `ci_app-backend`)          |
| Frontend    | Next.js 15, React, TypeScript, Tailwind (`fe/` — `ci_app-frontend`) |
| Local infra | Docker Postgres + **Caddy** HTTPS proxy (`devops/`)                 |
| Commands    | Root `Makefile` — run everything from the repo root                 |


---

## Prerequisites

Install these before the first run (macOS / Linux):


| Tool                                            | Version / notes                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| **Git**                                         | Any recent version                                                       |
| **Docker Desktop** (or Docker Engine + Compose) | Required for local Postgres (`make start-db`)                            |
| **Node.js**                                     | **20+** (LTS recommended)                                                |
| **Python**                                      | **3.12** (`python3.12` on your `PATH`)                                   |
| **GNU Make**                                    | Usually preinstalled on macOS/Linux                                      |
| **Caddy**                                       | **Required** for local HTTPS and tenant hostnames (`brew install caddy`) |


Verify:

```bash
docker --version
docker compose version
node -v          # v20+
python3.12 --version
make --version
caddy version
```

---

## First-time setup (clone → run)

All commands below run from the **repository root** unless noted.

### 1. Clone and enter the repo

```bash
git clone <your-remote-url> clinicle-ci
cd clinicle-ci
```

### 2. Create local environment files

Copy the committed examples (never commit real secrets):

```bash
cp be/config/.env.example be/config/.env.local
cp fe/.env.example fe/.env.local
```

Local defaults already match Docker Postgres and the Caddy / `*.clinicle-ci.local` workflow:

- DB: `postgresql://ci_user:ci_user@localhost:5432/ci_db`
- Schema: `ci` (`DB_SCHEMA=ci`)
- FE: `https://admin.clinicle-ci.local`
- API: `https://api.clinicle-ci.local/api/v1`
- Listen ports: FE `3000`, BE `8000`

**Keep JWT secrets in sync:** `AUTH2_SECRET_KEY` in `be/config/.env.local` must equal `JWT_PUBLIC_OR_SECRET` in `fe/.env.local` (the examples already match).

### 3. Add `/etc/hosts` entries (required)

The initial database ships with two tenants on `*.clinicle-ci.local`. System tests add disposable **Test Org A/B** on the same suffix. Map all of them (and the API host) to your machine:

```bash
sudo tee -a /etc/hosts <<'EOF'
127.0.0.1 admin.clinicle-ci.local
127.0.0.1 allure.clinicle-ci.local
127.0.0.1 api.clinicle-ci.local
127.0.0.1 testorg-a.clinicle-ci.local
127.0.0.1 testorg-b.clinicle-ci.local
EOF
```

If you already have the Allure/admin/api lines, append only the `testorg-*` entries. Confirm with `ping -c1 testorg-a.clinicle-ci.local`.


| Host                       | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `admin.clinicle-ci.local`     | Platform operations / super-admin tenant        |
| `allure.clinicle-ci.local`    | Allure Clinics (stable manual sample org)       |
| `api.clinicle-ci.local`       | Backend API                                     |
| `testorg-a.clinicle-ci.local` | Test Org A (disposable system-test primary)     |
| `testorg-b.clinicle-ci.local` | Test Org B (cross-org isolation)                |


### 4. Start PostgreSQL

```bash
make start-db
```

This starts the `db` service from `devops/docker-compose.yaml` (container `ci_db`, port `5432`).

If port `5432` is already in use, either stop the other Postgres or set `POSTGRES_PORT` when starting Compose (see `make help`).

### 5. Restore the initial database (required)

Do **not** rely on an empty schema created by the API. Load the committed seed dump so you get organizations, users, roles, and sample data:

```bash
make restore-db LOCAL_DB_TARGET=ci_db BACKUP_FILE=initial_load.dump
```

When prompted:

1. Select **1** — Local (Docker)
2. Answer **n** to the pre-restore backup question on a brand-new machine (optional on later restores)

The dump file is `[devops/db-backups/initial_load.dump](devops/db-backups/initial_load.dump)`.

#### What the initial load contains

**Organizations**


| Name                                | Domain                  | Notes                      |
| ----------------------------------- | ----------------------- | -------------------------- |
| Clinicle Intelligence Admin Console | `admin.clinicle-ci.local`  | Platform tenant            |
| Allure Clinics                      | `allure.clinicle-ci.local` | Sample organization tenant |


**Roles in this baseline**


| Role          | Scope        | Notes                      |
| ------------- | ------------ | -------------------------- |
| `super_admin` | Platform     | Clinicle Intelligence only |
| `org_owner`   | Organization | Highest org role (Allure)  |
| `org_admin`   | Organization | Org administration         |
| `user`        | Organization | Standard member            |


**Users (already seeded)**


| Email                  | Organization          | Role          |
| ---------------------- | --------------------- | ------------- |
| `super.admin@clinicle.com` | Clinicle Intelligence | `super_admin` |
| `org.owner@allure.com`     | Allure Clinics        | `org_owner`   |
| `org.admin@allure.com`     | Allure Clinics        | `org_admin`   |
| `user.one@allure.com`      | Allure Clinics        | `user`        |


Ask a teammate for the shared local password for these accounts (or use the app’s forgot-password / a local password-reset helper). Some accounts may prompt to change password on first login (`must_change_password`).

### 6. Install dependencies

```bash
make setup
```

This creates `be/.venv`, installs Python packages, and runs `npm install` in `fe/`.

### 7. Start Caddy (required)

Caddy terminates HTTPS and proxies tenant hosts to the local FE/BE ports. It is **required** for local development with `*.clinicle-ci.local`.

```bash
make run-caddy
```

Useful later: `make status-caddy`, `make restart-caddy` (after changing `PORT` in env files), `make stop-caddy`.

### 8. Start the backend

```bash
make run-be
```

Leave this terminal running. With Caddy up, the API is at [https://api.clinicle-ci.local](https://api.clinicle-ci.local) 

### 9. Start the frontend (second terminal)

```bash
make run-fe
```

Open the app at:

- Platform / Clinicle: [https://admin.clinicle-ci.local](https://admin.clinicle-ci.local)
- Allure tenant: [https://allure.clinicle-ci.local](https://allure.clinicle-ci.local)

---

## Daily development


| Goal                      | Command                                                         |
| ------------------------- | --------------------------------------------------------------- |
| Start DB                  | `make start-db`                                                 |
| Stop DB                   | `make stop-db`                                                  |
| Restore seed / other dump | `make restore-db` (or with `LOCAL_DB_TARGET=` / `BACKUP_FILE=`) |
| Caddy proxy               | `make run-caddy` / `make stop-caddy` / `make restart-caddy`     |
| Backend (reload)          | `make run-be`                                                   |
| Frontend (dev)            | `make run-fe`                                                   |
| Frontend (Turbopack)      | `make run-fe-turbo`                                             |
| Both (macOS Terminal)     | `make run-dev`                                                  |
| Lint FE + BE              | `make lint`                                                     |
| FE build                  | `make build-fe`                                                 |
| FE start                  | `make start-fe`                                                 |
| Full command list         | `make help`                                                     |


**Port conflicts:** set `PORT=` in `be/config/.env.local` and/or `fe/.env.local`, or pass `BE_PORT=` / `FE_PORT=` to Make. After changing ports, run `make restart-caddy`.

**Email:** `EMAIL_DELIVERY_ENABLED=false` by default. Messages are queued/logged as dry-run (no MailerSend needed for local work).

**Media:** `MEDIA_STORAGE=local` serves branding from `fe/local-media` at `/api/local-media/...`.

**Cron:** optional `make run-cron` dispatches DB-scheduled jobs every few minutes (prod-like). Inline schedulers stay off unless you set `ENABLE_INLINE_SCHEDULERS=true` in the BE env.

---

## Tests


| Suite                        | Setup                                   | Run                                 |
| ---------------------------- | --------------------------------------- | ----------------------------------- |
| Backend unit (no DB)         | `make test-unit-be-setup`               | `make test-unit-be-no-db`           |
| Backend unit + Postgres      | `make setup-test-db`                    | `make test-unit-be-db`              |
| Frontend unit                | `make test-unit-fe-setup`               | `make test-unit-fe`                 |
| API system tests             | `make test-st-api-setup` + running BE   | `make test-st-api MODULE=auth`      |
| UI system tests (Playwright) | `make test-st-ui-setup` + running stack | `make test-st-ui-run PROJECT=smoke` |


See `test_unit_be/`, `test_unit_fe/`, `test_st_api/`, and `test_st_ui/` READMEs for credentials and seeding details.

System-test harness tenants are **Test Org A** (`testorg-a.clinicle-ci.local`) and **Test Org B** (`testorg-b.clinicle-ci.local`). Add them to `/etc/hosts` (see §3), then provision with `npm run seed:bootstrap` in `test_st_ui` (requires `ST_SUPER_ADMIN_*` + `ST_DATABASE_URL`). Prefer `ST_*` env vars (system test). Do not point the harness at Allure — that org remains for stable manual use.

---

## Repository layout

```text
be/                 FastAPI application
fe/                 Next.js application
fe_mobile/          Flutter client (optional; make setup-mobile)
test_unit_be/       Backend unit / integration tests
test_unit_fe/       Frontend unit tests
test_st_api/        Live HTTP API system tests
test_st_ui/         Playwright UI system tests
devops/
  docker-compose.yaml   Local Postgres
  Caddyfile             Local HTTPS proxy (required)
  db-backups/           Includes initial_load.dump for first-time restore
  deploy/               Deploy env templates (GHCR / Render)
  scripts/              migrate-db, backup/restore helpers, SAST
  docs/                 Rules, system docs (BRD/SDD/ST), runbooks
Makefile            Single entry point for setup, run, test, deploy
```

---

## Branching and pull requests

Do not commit feature work directly on `dev`, `tst`, or `main`. Create a personal or feature branch for day-to-day development, usually branched from `dev`:

```bash
git fetch origin
git checkout dev
git pull origin dev
git checkout -b feature/<short-description>
```

When the work is ready:

1. Push your branch and open a **pull request into** `dev`.
2. Keep the PR focused; include a short summary and how you verified the change (`make lint`, relevant tests, manual smoke).
3. Address review feedback, then merge only after approval / required checks pass.

Environment promotion (`dev` → `tst` → `main`) is handled separately via the deploy promote flow — not by merging feature PRs straight into `tst` or `main`.

---

## Feature development cycle (with the AI agent)

For non-trivial work, collaborate with the AI agent on the feature branch before diving into code. The usual sequence:

1. **BRD** — Capture *what* the change must do in a module BRD under `devops/docs/system_docs/BRD/`. Prefer updating an existing module doc over inventing a parallel one. Templates: `devops/docs/system_docs/_templates/`.
2. **SDD** — Capture *how* it will be built in the matching design doc under `devops/docs/system_docs/SDD/` (software design plus developer unit-test inventory).
3. **Implementation plan** — Turn the BRD/SDD into a sequenced plan under `.cursor/plans/` (checklists, spikes, trade-offs). Plans are working notes; durable requirements stay in `system_docs/`.
4. **Test cases** — Define coverage while the design is fresh. Keep BRD story IDs for traceability:
   - **Unit** — developer unit inventory in the SDD; automate in `test_unit_be/` / `test_unit_fe/`
   - **UI** — module cases in `devops/docs/system_docs/ST-UI/`; automate in `test_st_ui/`
   - **API** — service-aligned cases in `devops/docs/system_docs/ST-API/`; automate in `test_st_api/`
5. **Build the feature** — Implement against the plan; keep edits scoped and run the relevant checks (`make lint`, unit/system tests).
6. **Documentation gate** — Finish or update the durable docs **during or immediately after** development. The build / review process expects documentation to be completed and understood before the code is committed and the PR merges — do not leave BRD/SDD/ST docs as a follow-up after merge.

Rules of thumb: plans go in `.cursor/plans/`; module BRD / SDD / ST-UI / ST-API go in `devops/docs/system_docs/`; engineering standards are in [`devops/docs/rules/AI_RULES.md`](devops/docs/rules/AI_RULES.md). Cross-link the plan and the system docs when useful.

---

## Configuration and deployment

- Commit only `*.env.example` files. Local `.env.local` / deploy secrets are gitignored.
- Deploy templates: `devops/deploy/` — copy `deploy.env.example` and the FE build-arg examples; do not commit live values.
- First-time local data comes from `make restore-db` + `initial_load.dump`. Numbered SQL migrations (when added under `devops/db-migrations/`) are applied with `make migrate-db`.
- Engineering rules for AI/humans: `[devops/docs/rules/AI_RULES.md](devops/docs/rules/AI_RULES.md)`
- Module BRD / SDD / ST-UI / ST-API docs: [`devops/docs/system_docs/`](devops/docs/system_docs/)

---

## License and ownership

No license grant is implied by this README. Define source-code ownership, reuse rights, third-party obligations, warranties, support, and handoff terms in the client agreement before delivery.