# [Module Name] — UI System Test Plan

Status: draft  
Last updated: YYYY-MM-DD  
Business requirements: [`NN-module-slug-BRD.md`](../BRD/NN-module-slug-BRD.md)  
Design: [`NN-module-slug-SDD.md`](../SDD/NN-module-slug-SDD.md)  
Unit tests: see [`NN-module-slug-SDD.md`](../SDD/NN-module-slug-SDD.md#unit-test-plan-and-coverage)

## Purpose and ownership

This QA-owned plan verifies **integrated business behavior in the browser**
(Playwright) plus manual/external release gates for this product module.

**Not owned here:**

| Concern | Home |
|---|---|
| HTTP contracts, authz matrices, persistence via API | `devops/docs/system_docs/ST-API/<service>-ST-API.md` → `test_st_api/tests/<service>/` |
| Unit/service/component tests | Module SDD unit-test section → `test_unit_be` / `test_unit_fe` |

Do not duplicate exhaustive API validation steps in this document. Link the
service ST-API doc / suite once in the traceability table.

## Test environments

| Environment | Purpose |
|---|---|

## Actors and test-data prerequisites

## Requirement traceability

| BRD ID | Playwright / manual / external cases | API evidence (ST-API / suite) |
|---|---|---|
| XX-01 | XX-ST-001 | `ST-API/<service>-ST-API.md` |

## Detailed test cases (UI)

### XX-ST-001 — [Test-case title]

Description: [Business-readable UI purpose. Combinatorial API checks stay in
the service ST-API / pytest suite.]

- BRD requirements: XX-01
- Priority: Critical | High | Medium | Low
- Test level: Playwright | Manual | External
- Release gate: Every release | Major release | Pilot only | Optional

Preconditions:

- [Actor and UI state]

Test data:

- [Deterministic values; prefer dedicated E2E orgs]

Steps:

1. [Browser action]

Expected results:

1. [Observable UI / user result]

Automation mapping:

- [Committed or planned `test_st_ui/test_modules/<NN-slug>/….spec.ts`]
- Optional legacy role path: `test_st_ui/tests/<role>/…`
- API depth: [pointer to `ST-API/<service>-ST-API.md`]

## Automation status (Playwright)

| Area | Path | Status |
|---|---|---|

## Manual and external validation

## Analytics system validation

## Execution history and evidence

## Known gaps and blockers

## System-test completion assessment
