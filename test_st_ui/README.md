# Browser acceptance tests

This Playwright suite validates the Clinicle Intelligence UI surface: authentication, the `user`, `org_admin`, and `super_admin` role boundaries, tenant isolation, core routing, legal pages, platform administration, and a thin typical-org baseline on **Test Org A**. It intentionally contains no product-domain journeys.

**Harness tenants:** `testorg-a.clinicle-ci.local` (Test Org A, primary) and `testorg-b.clinicle-ci.local` (Test Org B, cross-org isolation).  
**Stable manual tenant:** Allure (`allure.clinicle-ci.local`) from `initial_load.dump` — do not point the harness at Allure.  
**Platform host:** `admin.clinicle-ci.local` for `super_admin`.

`ST_*` env vars mean **system test** (matching `test_st_ui` / `test_st_api`). Legacy `E2E_*` names are accepted as a temporary fallback.

## Setup

1. Add harness hosts to `/etc/hosts` (see [Hosts](#hosts) and root README §3), then `make restart-caddy`.
2. Start the local stack from the repository root.
3. Copy `.env.example` to `.env` and set `ST_SUPER_ADMIN_*` (platform host `https://admin.clinicle-ci.local`).
4. Run `npm install` and `npx playwright install chromium` in this directory if dependencies are not present.
5. Set `ST_DATABASE_URL` and run `npm run seed:bootstrap` to create Test Org A/B personas; paste the printed `ST_*` lines into `.env`.

## Commands

- `npm test` — entire suite
- `npm run test:smoke` — public routing and page availability
- `npm run test:auth` — login behavior and validation
- `npm run test:user`, `test:org-admin`, or `test:super-admin` — role journeys
- `npm run test:matrix` — generated route-policy checks
- `npm run test:security` — cross-tenant boundary checks
- `npm run matrix:generate` — regenerate the route snapshot from frontend policy

From the repository root, `make test-st-ui-run PROJECT=security SPEC=tenant-isolation` offers the same targeted runner. Live execution requires the stack and disposable credentials; TypeScript compilation and `playwright test --list` are safe structural checks.

Generated credentials, storage state, reports, and traces are local artifacts and must not be committed.

## Architecture

The suite has four layers:

1. `smoke` and `auth` verify anonymous routing, legal pages, responsive rendering, and login behavior.
2. Role projects authenticate the canonical `user`, `org_admin`, and `super_admin` personas once and reuse Playwright storage state.
3. Matrix projects compare navigation outcomes with frontend route policy; `npm run matrix:generate` refreshes the checked-in snapshot.
4. `security` exercises tenant and privilege boundaries through the public API, where those controls are enforced.

Seed helpers create only organizations, canonical users, and roles. **Test Org A** (`testorg-a.clinicle-ci.local`) is the primary tenant and **Test Org B** (`testorg-b.clinicle-ci.local`) is the isolation tenant. Personas: `org_owner`, `org_admin`, `user`. Seed data is tagged with a run identifier (`st+run-…`) so cleanup can be scoped safely. Allure remains the stable manual org and is not a harness default.

Shared credentials use the `ST_*` prefix (system test), matching `test_st_ui` / `test_st_api`.

The browser suite complements, rather than replaces, backend authorization tests. It requires a running application and test-only accounts; it is not a hosted CI service by itself.

## Test plan

| Area | Acceptance coverage |
| --- | --- |
| Public surface | Root routing, login/register/reset pages, legal pages, mobile viewport |
| Authentication | Validation, valid and invalid login, session navigation |
| User | Authenticated route availability and denial of administrative routes |
| Organization admin | Tenant-admin route access, org settings smoke, org users list (Test Org A) |
| Super admin | Platform-host access and platform administration |
| Route policy | Anonymous and role-specific outcomes generated from frontend policy |
| Tenant security | Cross-tenant reads and mutations are denied (Test Org A ↔ Test Org B) |

Release evidence consists of TypeScript compilation, successful Playwright discovery, and a live run against disposable local or staging data. Failures caused by missing credentials or an unavailable stack must be reported as environment-dependent, not as passing tests.

## Selector policy

Prefer accessible roles, labels, and visible names. Add `data-testid` only when the element has no stable accessible identity or when a security assertion must avoid ambiguous content. Test IDs must describe generic behavior, not a former product domain, and must not encode database IDs or tenant-specific values.

When a UI refactor changes a selector, update the smallest relevant spec and confirm `npx playwright test --list` still discovers every retained project.

## Seed toolkit

The `seed/` toolkit provisions two disposable organizations — **Test Org A** (`testorg-a.clinicle-ci.local`) and **Test Org B** (`testorg-b.clinicle-ci.local`) — with canonical `org_owner`, `org_admin`, and `user` personas. Supports role tests and cross-tenant isolation only; downstream products should add their own domain fixtures separately.

**Do not** seed against Allure (`allure.clinicle-ci.local`). Allure is the stable manual org from `initial_load.dump`. Harness suites mutate Test Org A/B only.

Credentials use the `ST_*` prefix (**system test**). Bootstrap requires only `ST_SUPER_ADMIN_*` (no prior org-admin / Allure account). Platform host for super_admin is `admin.clinicle-ci.local`.

User emails use `@testorg-a.clinicle-test.com` / `@testorg-b.clinicle-test.com` (not `@*.clinicle-ci.local`) because the API EmailStr validator rejects `.local` as a reserved TLD. Org **hosts** remain `*.clinicle-ci.local`.

### Hosts

Add the harness hosts (once) if they are not already in `/etc/hosts`:

```bash
sudo tee -a /etc/hosts <<'EOF'
127.0.0.1 testorg-a.clinicle-ci.local
127.0.0.1 testorg-b.clinicle-ci.local
EOF
```

You also need `admin.clinicle-ci.local` and `api.clinicle-ci.local` (same block as Allure in the root README). After editing hosts, restart Caddy (`make restart-caddy`) so the new site names are served.

### Seed commands

- `npm run seed:check` validates API login as Test Org A admin and optional database connectivity.
- `npm run seed:bootstrap` creates missing organizations and personas and prints local `.env` values (`ST_*`).
- `npm run seed:scenario -- freshUser` creates a disposable generic user scenario.
- `npm run seed:cleanup -- --run-id <id>` removes only data tagged for that test run (`st+run-…` emails).

Use a non-production database and test-only credentials. Direct database access (`ST_DATABASE_URL`) is required for bootstrap, truth-oracle assertions, and cleanup.
