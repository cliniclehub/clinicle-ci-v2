# Public Website — UI System Test Plan

Status: draft  
Last updated: 2026-09-30  
Business requirements: [`01-public-website-BRD.md`](../BRD/01-public-website-BRD.md)  
Design: [`01-public-website-SDD.md`](../SDD/01-public-website-SDD.md)

## Purpose and ownership

Browser proof that tenant public pages resolve correctly and do not leak peer
tenant content.

| Concern | Home |
|---|---|
| HTTP org public contracts | `ST-API/organizations-ST-API.md` |
| Unit/service tests | Module SDD |

## Test environments

| Environment | Purpose |
|---|---|
| Local / ST FE | Hostname or header mapped to seeded org domain |
| CI Playwright | Smoke + matrix suites under `test_st_ui/` |

## Actors and test-data prerequisites

- Two seeded organizations with distinct domains and landing/legal content

## Requirement traceability

| BRD ID | Playwright / manual / external cases | API evidence |
|---|---|---|
| PW-01 | PW-ST-001 | `organizations-ST-API.md` |
| PW-02 | PW-ST-002 | `organizations-ST-API.md` |
| PW-04 | PW-ST-003 | — |

## Detailed test cases (UI)

### PW-ST-001 — Landing resolves for tenant host

- BRD requirements: PW-01
- Priority: Critical
- Test level: Playwright
- Release gate: Every release

Preconditions: org A domain reachable in test env  
Steps: open landing on org A host; assert org A branding/content  
Expected: no org B content

### PW-ST-002 — Legal pages show tenant copy

- BRD requirements: PW-02
- Priority: High
- Test level: Playwright | Manual

### PW-ST-003 — Unauthorized page renders

- BRD requirements: PW-04
- Priority: Medium
- Test level: Playwright

## Automation status (Playwright)

| Area | Path | Status |
|---|---|---|
| Smoke / matrix | `test_st_ui/tests/smoke`, `tests/matrix` | Existing baseline |
| Module folder | `test_modules/01-public-website/` | Optional; add when expanding |

## Known gaps and blockers

- Dedicated module ST folder may not exist yet; use smoke/matrix until added.

## System-test completion assessment

Partial — public routes exist; deepen tenant-isolation browser cases as hosts
are available in CI.
