# Platform AI Coding Rules

These rules are the shared instruction source for AI coding assistants working in this repository. They are written to be used by Cursor, Claude, and Codex.

## Project Context

This repository is a multi-tenant application baseline.

- Backend: FastAPI, Python, SQLAlchemy ORM, PostgreSQL (schema `app`)
- Frontend: Next.js 15, React, TypeScript, shadcn/ui
- Authentication: custom JWT authentication
- Storage: local disk for branding assets when `MEDIA_STORAGE=local` (`/api/local-media/...`); Cloudflare R2 (or MinIO later) for object storage when configured
- Tenants: hostname → `organizations.domain`; one user per organization
- Roles: `super_admin` (platform), `org_owner`, `org_admin`, `user`

How to extend:

- New domain = new folder under `be/app/v1/<domain>/` with `model.py` (`organization_id` + schema `app`), `routes.py`, `services.py`; register once in `router.py`.
- New FE area = route group + sidebar entry + middleware prefix/role rule.
- New email = add a `template_key` to `default_templates.json` and enqueue via the email engine.
- Do not put tenant data in tables without `organization_id`.

Primary directories:

- `be/`: backend application
- `fe/`: frontend application
- `test_unit_be/`: backend tests
- `test_unit_fe/`: frontend tests
- `test_st_ui/`: end-to-end tests
- `test_st_api/`: API system tests
- `devops/`: deployment, database migrations, Cloudflare workers, scripts, and project documentation (see Documentation locations)
- `.cursor/plans/`: Cursor implementation plans and architectural discussion notes

## Documentation locations

Put new written artifacts in the correct folder. Do not dump plans into `devops/docs/` root or mix plan scratchpads with durable product specs.

| Kind of document | Location | Examples |
|------------------|----------|----------|
| Planning, implementation plans, architectural discussions, ADRs drafted during coding sessions, Cursor plan files | `.cursor/plans/` | feature rollout plans, spike notes, sequenced implementation checklists, architecture trade-off writeups from agent sessions |
| Module BRD / SDD / QA system tests | `devops/docs/system_docs/` | flat `BRD/*-BRD.md`, `SDD/*-SDD.md`, `ST-UI/*-ST-UI.md`, `ST-API/<service>-ST-API.md` |
| Cross-module requirements/design not yet assigned to a module | `devops/docs/req & design/` | temporary cross-module specifications awaiting an approved owner |

Rules:

- When creating or updating a **plan** or **architecture discussion**, write under `.cursor/plans/` (use `archive/` under that tree for completed/superseded plans when appropriate).
- When creating or updating durable **module requirements, software design, or
  QA system-test documents**, write under `devops/docs/system_docs/` (see that tree’s
  `README.md`). Do not recreate per-module `NN. Module Name/` folders.
- Use `devops/docs/req & design/` only for a genuinely cross-module durable
  specification that does not yet have an approved module owner. Move it into
  `devops/docs/system_docs/` when ownership is established.
- Do not place new requirement/design docs under `devops/docs/design/`, `devops/docs/` root, or `.cursor/plans/`.
- Do not place session plans or architectural scratchpads under
  `devops/docs/system_docs/` or `devops/docs/req & design/`.
- Cross-link between the two when useful (e.g. a Cursor plan may reference a design doc, and a design doc may link to the implementing plan).
- `devops/docs/rules/` remains for AI/engineering rules only (this file and related standards).
- `devops/docs/archive/` is for retired docs only; do not add active plans or specs there.
- `devops/docs/modules_docs/` is retired (pointer only); do not add new module docs there.

## General Assistant Behavior

- Read the existing code before changing it.
- Follow nearby patterns over inventing new abstractions.
- Keep edits scoped to the requested change.
- Do not revert unrelated user changes.
- Prefer small, clear changes with tests when behavior changes.
- Use existing helper utilities, components, schemas, and exception types.
- Avoid broad refactors unless they are required for the task.
- Never commit secrets, credentials, environment files with real values, or generated build artifacts.
- When instructions conflict, prefer the repository's current implementation patterns over old archived examples.

## Common Commands

Backend:

```bash
cd be
make setup
make run
make test
make lint
```

Frontend:

```bash
cd fe
npm install
npm run dev
npm run build
npm run lint
```

Use the test command closest to the changed code. If a command cannot be run, explain why.

## Architecture Rules

- All backend API routes should live under the `/api/v1/` API structure.
- Use the service pattern: routers handle HTTP concerns, services contain business logic.
- Services should return data objects and raise business exceptions.
- Routers should translate successful service results into the standard response format.
- Global exception handling should convert business exceptions to HTTP responses.
- Keep tenant isolation in mind for all data access.
- Keep role permissions in mind for all user-facing workflows.

Canonical user role keys:

1. `super_admin`: Super Admin (platform only) — system role; immutable full `platform.*` permissions
2. `org_owner`: Organization Owner — system role; immutable full `org.*` permissions; implies `org_admin` for capability checks; only a platform super admin may assign it; org routes cannot manage owner accounts
3. `org_admin`: Organization Admin — system role; immutable full `org.*` permissions; may be assigned by org owners (not by other org admins)
4. `user`: User (default self-signup / org-assignable role) — system role; no admin catalog permissions

Authorization is **permission-based**. Roles are bundles of permissions from a fixed catalog.
Org-scoped **custom roles** may mix-and-match `org.*` permissions; system role grants cannot be changed.
Prefer `has_permission` / `require_permission` (or FE `requirePermission`) over new role allowlists.

Use these role keys for new code and documentation.

### `super_admin` scope (platform vs organization)

`super_admin` is a **platform** role, not an organization role. Treat it separately from org staff roles (`org_owner`, `org_admin`, `user`).

**Default policy — do not add `super_admin` to org ACLs unless explicitly requested:**

- **Platform scope (appropriate):** creating/managing organizations, platform-wide configuration, dedicated platform-admin routes, cross-tenant operations that are intentionally built for operators.
- **Organization scope (not by default):** org user day-to-day workflows, media within an org tenant, or any `has_any_role([...])` list meant for org staff.

**When implementing authorization or audit fixes:**

- Do **not** “fix” missing `super_admin` in org inline role lists by adding it as a bypass.
- Do **not** assume `super_admin` should reach org endpoints the way `org_admin` does.
- If product requirements call for platform operators to access org data, add **explicit** platform routes or a deliberate, documented override — only when the user or task specifies that behavior.

Org tenant isolation and owner/staff scope checks apply to org APIs regardless of whether the caller also holds `super_admin`.

## Backend Rules

### File Organization

Backend feature modules should generally use this shape:

```text
feature_name/
|-- model.py
|-- schema.py
|-- services.py
`-- routes.py
```

### Backend Imports

Prefer established imports from the codebase. Common route imports include:

```python
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import get_current_user, UserTokenInfo
from app.common.business_exceptions import AuthorizationError, NotFoundError, BadRequestError
```

Common service imports include:

```python
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.common.business_exceptions import (
    AuthorizationError,
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
```

### Backend Logging

- Do not use `print`.
- Use the repository logger:

```python
from app.common.app_logger import get_logger

class_logger = get_logger(__name__)
method_logger = class_logger.get_method_logger("method_name")
```

- Log useful context with `extra`.
- Use `exc_info=True` when logging caught exceptions that will be re-raised or handled.

### Backend Comments

For larger route or service files, use the established section comments:

```python
#********************************************************************************
# Create Course
#********************************************************************************
```

For smaller service subsections:

```python
#---------------------------------
# Create Course
#---------------------------------
```

Do not add decorative comments where the code is already clear.

### Backend Error Handling

- Use business exceptions from `app.common.business_exceptions`.
- Do not return raw exception details to clients.
- Validate authorization and tenant ownership before mutating or exposing data.
- Handle database integrity errors and raise domain-appropriate exceptions.
- Keep API responses in the standard `success`, `message`, `data`, and `error` shape.

### Backend Database Rules

- Use SQLAlchemy ORM patterns already present in the module.
- Avoid N+1 queries; use `joinedload` or appropriate eager loading for list views.
- Always scope tenant-owned data by organization or tenant identifier.
- Add migrations for schema changes.
- Put new SQL in `devops/db-migrations/` as `NNN_short_name.sql` (three-digit prefix from `001`; `archive/` is historical only). Apply with `make migrate-db` (or it runs as part of `make deploy-*`). Do not change archived migrations unless explicitly requested; add a new migration instead.

### Database ID Strategy

Before choosing or changing primary-key types for new tables or migrations, read [`database-id-strategy.md`](database-id-strategy.md). For migration execution order, see [`../archive/MIGRATION_RUNBOOK_ID_STRATEGY.md`](../archive/MIGRATION_RUNBOOK_ID_STRATEGY.md).

| Tier | PK type | Use when |
|------|---------|----------|
| **1 — External identity** | `UUID` | Shareable URLs, checkout, auth subjects, commerce, gradebook attempts |
| **2 — Internal high-volume** | `BIGSERIAL` | Append-only logs, progress, telemetry; PK never in public URLs |
| **3 — Static / junction / org config** | `INTEGER`, natural keys, or composite PK | Lookups, M:N links, org labels, per-user UI prefs, 1:1 extension rows |

Rules of thumb:

- Do **not** default to UUID just because an `id` appears in a JSON API body. Ask: is this ID in a **shareable URL** or an **external system** (Stripe, Clerk)?
- Junction / M:N tables: composite PK, not surrogate UUID.
- 1:1 extension tables: prefer parent FK as PK when possible.
- Tier 1 IDs in TypeScript/API: `id: string`. Tier 2/3 org config after migration: `id: number`.

## Frontend Rules

### Frontend Imports

For client components:

```typescript
"use client"

import { createClientLogger } from "@/lib/utils/logger-client"
```

For server actions:

```typescript
import { createServerLogger } from "@/lib/utils/logger-server"
import { apiCaller } from "@/lib/utils/api-caller-helper"
import { ApiResponse } from "@/lib/types/api-response-schema"
```

For API error handling:

```typescript
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { toast } from "sonner"
```

Use exact import paths that exist in the current codebase.

### Frontend Logging

- Do not use `console.log`, `console.error`, or similar console calls in committed code.
- Use the repository logger:

```typescript
const logger = createClientLogger("CourseForm")
const methodLogger = logger.forMethod("handleSubmit")

logger.info("Saving course", { courseId })
logger.error("Failed to save course", error as Error, { courseId })
```

Logger names:

- Component names: PascalCase
- Method names: camelCase

### Component Rules

- Prefer existing shadcn/ui and local UI components.
- Use server actions for API calls unless the current feature already follows another pattern.
- Keep reusable components in `components/`.
- Keep route-specific UI near the route when it is not reusable.
- Follow existing role-based route groups.
- Use the existing error dialog and toast patterns for user-facing failures.
- **Navigation vs actions:** If a control’s primary job is to go to another page/route, use Next.js `<Link>` (or `Button asChild` / `DropdownMenuItem asChild` + `<Link>`). If its primary job is an action (mutate, submit, open dialog, toggle, delete), use `<button>` / `Button` — never a fake link. Prefer `router.push` only for programmatic navigation (after submit, auth redirect, conditional routing), not for clickable nav UI. Do not wrap a whole card/row in `<Link>` when it already contains other buttons/menus; link the title or a dedicated CTA instead. Navigational Links in UI chrome (sidebar, menus, buttons) must keep the ambient component text color and must not look like content hyperlinks (no default accent/blue link styling); right-click / open-in-new-tab behavior comes from the real `href`, not from link-colored text.

Typical form component order:

1. State declarations
2. Logger initialization
3. React Hook Form setup
4. Effects
5. Event handlers
6. Submit handler
7. Render

### Form Rules

- Use React Hook Form for substantial forms.
- Use Zod validation when the feature already has a schema pattern.
- Use dirty-state handling for edit forms.
- Use existing `FormSection`, `FormFooter`, and `DirtyFormDialog` components when appropriate.
- Reset the form after successful save so dirty state is correct.

### API Call Rules

- Prefer server actions in `fe/lib/actions/`.
- Use `apiCaller` instead of hand-written fetch wrappers unless nearby code does otherwise.
- Use shared TypeScript types from `fe/lib/types/`.
- Handle API errors through the shared error helpers.
- Do not assume a response succeeded only because the HTTP request returned.

### Frontend Styling Rules

- Follow the existing shadcn/ui, Tailwind, and design-token patterns.
- Keep operational screens dense, scannable, and predictable.
- Avoid marketing-style sections for internal product workflows.
- Make controls accessible, labeled, and keyboard friendly.
- Do not create one-off visual systems when a shared component exists.

## Security Rules

- Never expose secrets in client code.
- Keep authentication and authorization checks server-side for protected data.
- Validate tenant and organization access on both read and write paths.
- Sanitize or validate user-generated content where it is rendered.
- Be careful with file upload types, sizes, and storage keys.
- Do not log sensitive tokens, passwords, or personal data.

## Performance Rules

- Backend: paginate list endpoints and avoid unnecessary eager loading of large relationships.
- Backend: batch or optimize queries for dashboards and reports.
- Frontend: avoid unnecessary client components; use server components where appropriate.
- Frontend: avoid refetch loops and expensive render work in large tables.
- Use existing caching or revalidation patterns when present.

## Testing Rules

- Read [`QA_STRATEGY.md`](QA_STRATEGY.md) when creating or substantially changing
  a BRD, unit-test plan, system-test plan, API workflow, or critical user workflow.
- When a feature has a BRD, preserve its requirement/story IDs in test
  documentation and maintain traceability to relevant automated or manual tests.
- Major modules should keep durable docs under `devops/docs/system_docs/`:
  - `*-BRD.md` in `BRD/`
  - `*-SDD.md` in `SDD/` (software design **plus** developer unit-test
    inventory — do not create a separate `*-UT.md`)
  - `*-ST-UI.md` in `ST-UI/` for QA-owned **Playwright UI**, manual, and
    external release-gate validation
  - `<service>-ST-API.md` in `ST-API/` for QA-owned **pytest HTTP** suites
    aligned to `test_st_api/tests/<service>/`
- Do not place exhaustive API matrices in ST-UI; link the matching ST-API doc /
  service suite instead.
- Backend behavior changes should include or update focused unit tests in `test_unit_be/` when practical, especially for services, permissions, enrollment, payments, pricing, and API response behavior.
- Frontend behavior changes should include or update focused unit/component tests in `test_unit_fe/` when practical, especially for shared components, hooks, form behavior, role-based UI, catalog displays, and checkout/enrollment UX.
- Backend API changes should include focused API coverage when
  practical in `test_st_api/`, especially for contracts, persistence,
  authorization, and tenant isolation; organize those suites **by service**
  (matching `be/app/v1/…`), not by product module folder. Keep the matching
  `ST-API/<service>-ST-API.md` inventory current. Mocked service tests
  in `test_unit_be/` alone do not prove endpoint behavior.
- End-to-end coverage in `test_st_ui/` should be added or updated for critical user workflows, especially checkout, enrollment, authentication, tenant routing, payment recovery, catalog visibility, and role-based access.
- Critical workflows without Playwright coverage must have a documented reason
  and a manual test/release gate in the module ST-UI document.
- Run the most relevant backend, frontend, or E2E checks for the changed area before finishing. If a check cannot be run, explain why.
- For bug fixes, add regression tests when the existing test structure makes that practical.
- Do not mark a BRD story or module system-tested merely because unit tests pass.
- Before finishing a major module, update its SDD unit section and ST-UI / ST-API
  coverage documents as applicable, and report tests added, tests executed,
  checks not run and why, and remaining coverage gaps.

### E2E (`test_st_ui/`) — read `test_st_ui/README.md` first

**Two spec layouts:**

| Layout | Path | Purpose |
|--------|------|---------|
| Role journeys | `tests/<role>/` | Who is logged in; role permissions and day-to-day flows |
| Module ST-UI journeys | `test_modules/<NN-module-slug>/` | Product-module UI system tests aligned with `devops/docs/system_docs/ST-UI/*-ST-UI.md` |
| Page objects | `pages/<feature>.page.ts` | Selectors and reusable UI actions (shared) |
| Support | `support/constants.ts`, `support/fixtures.ts`, `support/roles.ts` | Routes, fixtures, creds, auth files |

**Reuse page objects; organize specs by role *or* by module ST — not both in one file.**

- Role folder: logged-in user (`tests/user/`, `tests/org-admin/`, etc.). One Playwright project per folder; do not combine roles in one spec file.
- Module folder: `test_modules/01-public-website/` etc. Playwright project `modules`. Tag cases with ST ids (`PW-ST-002`). See `test_modules/README.md`.
- Reuse the same page object when multiple roles or modules hit the same UI.
- Access denied: reuse `ROUTES`, assert redirect to `/unauthorized` in the blocked role's folder.
- Start org-scoped feature coverage under `tests/org-admin/`, then add thin specs for other roles that share the page. Do not assume org-admin passing covers other roles.

**Minimal smoke vs full POM**

- Smoke (goto + assert heading): spec only, use `page` and `ROUTES` — see `tests/org-admin/courses.spec.ts`.
- Multi-step or reused flows: add `pages/<feature>.page.ts`, register fixture in `support/fixtures.ts`.
- Playwright codegen is for discovering selectors; extract into page objects — do not commit raw codegen output.

**Required in role specs**

- Import from `support/fixtures.ts`
- `test.describe` with role tag from `getRoleBySlug()` (e.g. `@org-admin`)
- `test.skip(!hasXCredentials(), roleCredentialSkipMessage(role))` when creds are required
- Role projects use saved sessions from `auth.setup.ts` — no per-test login

**Run from repo root:** `make test-st-ui-run` (full suite); `PROJECT=org-admin`; `SPEC=courses`; `GREP="test title"`; `HEADED=1` / `SLOW=1` for visible debugging.

## Code Review Checklist

Before finishing a change, check:

- Does it follow nearby patterns?
- Are tenant, role, and authorization checks correct?
- Are errors handled with shared helpers or business exceptions?
- Are logs useful and free of sensitive data?
- Are API responses in the standard shape?
- Are types and schemas updated?
- Are migrations included for database schema changes?
- Were relevant tests or checks run?
