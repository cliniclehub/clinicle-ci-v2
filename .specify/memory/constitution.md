<!--
Sync Impact Report
- Version change: (none / template placeholders) → 1.0.0
- Modified principles: N/A (initial ratification from empty scaffold)
- Added sections:
  - Core Principles I–V (Rules Fidelity, Tenant Isolation, Scoped Changes,
    Behavior-Change Tests, Service Boundaries & Authorization)
  - Technology Stack Constraints
  - Documentation and Artifact Placement
  - Governance
- Removed sections: none
- Follow-up TODOs: none
-->

# Clinicle Intelligence Constitution

## Core Principles

### I. Rules and Pattern Fidelity

All work in this repository MUST follow
`devops/docs/rules/AI_RULES.md` as the shared instruction source for AI and
human contributors.

- Prefer **existing FastAPI / Next.js patterns** already present in the codebase
  over inventing new abstractions, frameworks, or one-off conventions.
- Read nearby modules before changing them; reuse helpers, components, schemas,
  exception types, and logger utilities that already exist.
- When instructions conflict, prefer **current implementation patterns** over
  archived examples or external defaults.
- Never commit secrets, credentials, real environment values, or generated build
  artifacts.

**Rationale**: Consistency keeps multi-tenant clinical software reviewable,
maintainable, and safe for agent-assisted changes.

### II. Multi-Tenant Data Isolation (NON-NEGOTIABLE)

Tenant-owned data MUST include `organization_id` (or the established tenant
identifier for that table) and MUST be scoped by organization on every read and
write.

- Do not put tenant data in tables without `organization_id`.
- Validate authorization and tenant ownership before mutating or exposing data.
- Keep role and permission checks in mind for all user-facing workflows.
- Treat `super_admin` as a **platform** role: do not add it to org ACLs unless
  the task explicitly requires a documented platform override.

**Rationale**: Hostname → organization tenancy is a hard product boundary;
leaks across tenants are unacceptable.

### III. Scoped Change Discipline

Keep edits scoped to the requested change.

- Do not revert unrelated user changes.
- Prefer small, clear diffs; avoid broad refactors unless required for the task.
- Do not expand scope into feature implementation, deployment, or drive-by
  cleanup when the active Spec Kit step is governance, specification, or
  planning only.

**Rationale**: Narrow diffs are easier to review, test, and roll back in a
monorepo with shared platform code.

### IV. Behavior Change Requires Tests

Any change that alters observable behavior MUST include or update tests in the
suite closest to the change.

- Backend unit: `test_unit_be/` (and `cd be && make test` / root Make targets).
- Frontend unit: `test_unit_fe/`.
- API system: `test_st_api/`; UI e2e: `test_st_ui/` when the change warrants it.
- If a relevant check cannot be run, state why; do not silently skip coverage
  for intentional behavior changes.

**Rationale**: Specs and plans are incomplete without verification that protects
tenant isolation, auth, and regressions.

### V. Service Boundaries and Authorization

Backend features MUST use the established service pattern under `/api/v1/`.

- Routers handle HTTP; services contain business logic and raise business
  exceptions; responses use the standard success/message/data/error shape.
- New domains live under `be/app/v1/<domain>/` with `model.py`, `routes.py`,
  `services.py` (and `schema.py` when needed), registered once in `router.py`.
- Authorization is **permission-based**; prefer `has_permission` /
  `require_permission` (and FE equivalents) over new role allowlists.
- Frontend work MUST follow existing route groups, server-action / `apiCaller`
  patterns, shadcn/ui components, and repository loggers (no `console.log` or
  `print` in committed code).

**Rationale**: Shared boundaries keep API contracts and UI auth consistent
across modules.

## Technology Stack Constraints

- **Backend**: FastAPI, Python 3.12, SQLAlchemy ORM, PostgreSQL (`app` / configured
  schema); migrations as new numbered SQL under `devops/db-migrations/`.
- **Frontend**: Next.js 15, React, TypeScript, Tailwind, shadcn/ui.
- **Auth**: Custom JWT; sync secrets across BE/FE local env examples only—never
  commit real secrets.
- **Storage**: Follow existing `MEDIA_STORAGE` local vs object-storage patterns.
- **IDs**: Follow `devops/docs/rules/database-id-strategy.md` before choosing
  primary-key types (do not default to UUID without need).

## Documentation and Artifact Placement

- Session plans / architecture discussions: `.cursor/plans/`.
- Module BRD / SDD / system tests: `devops/docs/system_docs/`.
- Cross-module specs without an owner yet: `devops/docs/req & design/`.
- AI/engineering rules only: `devops/docs/rules/` (including `AI_RULES.md`).
- Do not dump new specs into `devops/docs/` root, `devops/docs/design/`, or
  retired `devops/docs/modules_docs/`.

## Governance

This constitution governs Spec Kit planning and implementation for Clinicle
Intelligence. It MUST be consulted by `/speckit-specify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-implement`, `/speckit-analyze`, and related skills.

- **Precedence**: `AI_RULES.md` and this constitution together override ad-hoc
  prompting; where they conflict on a detail, `AI_RULES.md` and current code
  patterns win for implementation specifics, while this file states
  non-negotiable project principles.
- **Amendments**: Update `.specify/memory/constitution.md` via
  `/speckit-constitution` (or equivalent review). Record version, ratification,
  and last-amended dates. Use semantic versioning: MAJOR for removed/redefined
  principles, MINOR for new or materially expanded guidance, PATCH for
  clarifications.
- **Compliance**: PRs and agent runs MUST keep tenant isolation, scoped diffs,
  and tests for behavior changes. Complexity and new abstractions MUST be
  justified against existing patterns.
- **Runtime guidance**: Use `devops/docs/rules/AI_RULES.md` for day-to-day
  coding rules; use Spec Kit artifacts under `.specify/` for feature specs,
  plans, and tasks.

**Version**: 1.0.0 | **Ratified**: 2026-10-02 | **Last Amended**: 2026-10-02
