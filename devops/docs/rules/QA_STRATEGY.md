# Unit and System Test Traceability Strategy

Status: active engineering standard  
Last updated: 2026-08-03

## Purpose

This strategy defines how business requirements become verifiable manual and
automated tests. It applies to new modules, major feature changes, critical user
workflows, and material bug fixes.

The objective is not to maximize test count. It is to provide traceable evidence
that each business requirement works at the lowest reliable test level and that
critical workflows work across system boundaries.

## Documentation model

Durable feature documentation uses these complementary documents under
`devops/docs/system_docs/`:

```text
BRD/<NN>-<slug>-BRD.md
    What the product must do and why

SDD/<NN>-<slug>-SDD.md
    How the requirement is implemented, including developer unit-test inventory

ST-UI/<NN>-<slug>-ST-UI.md
    How QA proves browser journeys and release readiness (Playwright +
    manual/external)

ST-API/<service>-ST-API.md
    How QA proves HTTP contracts, authz, tenant isolation, and persistence
    via pytest against a running backend (service-aligned)
```

Filenames are unique and flat (no per-module subfolders). Sort by module number.

The relationship is:

```text
BRD requirement/story ID
    → SDD unit-test section and/or ST-UI / ST-API case
        → automated test or manual procedure
            → execution result and evidence
```

Implementation plans and temporary testing notes do not belong in these durable
documents. Put planning material under `.cursor/plans/`.

## Stable identifiers

Every BRD user story or independently testable requirement should have a stable
feature-prefixed ID:

```text
PF-01       Platform-fee requirement 1
PC-03       Payment-calculation requirement 3
```

Feature unit and system test cases use separate sequences:

```text
PF-UT-001
PF-ST-001
PC-ST-001
```

Requirements and test-case IDs must not be renumbered merely because a new item
is inserted. Retired IDs remain reserved and should be marked retired with a
short reason.

Automated test names or nearby comments should include the test or BRD ID when it
materially improves traceability. Do not make test names unreadable solely to
include every related identifier; the two feature test matrices remain the
canonical mapping.

## Test levels

Use the lowest reliable level that proves the behavior. Add higher-level tests
when system boundaries, authorization, persistence, or critical user journeys
also need proof.

### Backend unit and service tests

Location: `test_unit_be/`

Use for:

- Business calculations and decision tables
- Validation and error behavior
- Permissions and tenant-scope service logic
- State transitions
- Webhook handlers and idempotency
- Refund, payment, enrollment, and pricing services
- Boundary cases and failure recovery

These tests should be fast and exhaustive. Mock external providers only at the
provider boundary, not the business logic being tested.

### Frontend unit and component tests

Location: `test_unit_fe/`

Use for:

- Zod/form validation
- Conditional field visibility and disabled/read-only behavior
- Hooks and shared utilities
- Component interaction and state transitions
- Role-sensitive presentation
- Order-summary and pricing display behavior
- Accessibility behavior that can be verified at component level

**Coverage gate:** measure Vitest line coverage on `fe/lib/utils/**` only
(`make test-unit-fe-cov`). Leadership target **80%** (stretch **85–90%**). Do not
set an 85%+ unit gate on all of `fe/` or `fe/components` — pages and most UI
shells are Playwright (`test_st_ui`) or manual. Optional broad report:
`make test-unit-fe-cov-broad`.

Do not rely on frontend tests to prove server authorization, tenant isolation, or
financial persistence.

### API and integration tests

Location: `test_st_api/` for authenticated HTTP/API system tests. Suites are
**service-aligned** (folders mirror backend packages such as `auth/`,
`organizations/`), not product-module folders. Optional `COVERAGE.md` in a
service folder maps BRD IDs to specs. Database-heavy integration tests may
remain in another established integration-test location only when the
repository already uses that pattern for the affected module.

Pytest is the standard and only automated runner for this layer. These tests
send HTTP requests to a running backend; using pytest does not make them unit
tests. Postman collections and Newman are not part of the repository test
stack. Use `make test-st-api` for the full suite or
`make test-st-api MODULE=<service>` for one service-aligned suite.

Use for:

- Request and response contracts
- Authentication and role authorization
- Organization and tenant isolation
- Database persistence and transaction behavior
- Validation error envelopes and status codes
- Pagination, filtering, date ranges, and exports
- Idempotency across route/service/database boundaries
- Migrations or database constraints where application-only tests are insufficient

An API feature is not fully covered merely because its service was tested with
mocks. Endpoint behavior should have API coverage when practical.

Module `*-ST-UI.md` documents should **link** `ST-API/<service>-ST-API.md`
(and the pytest suite) for BRD traceability; they should not restate full API
step matrices. Pilot examples: Module 01 → `organizations`, Module 02 → `auth`.

### Playwright end-to-end tests

Location: `test_st_ui/`

Use for critical workflows that must be proven through the browser and system
boundaries, especially:

- Checkout and payment
- Enrollment and access
- Authentication and account recovery
- Tenant/domain routing
- Role-based access and read-only behavior
- Payment recovery
- Catalog visibility
- Multi-step configuration that affects a downstream user workflow

Module `*-ST-UI.md` is the durable, **module-organized** home for these UI system
cases (plus manual/external gates). Prefer happy paths and representative
visible failures; leave combinatorial validation to unit/API layers.

Read `test_st_ui/README.md` before adding or changing Playwright coverage. That
file is authoritative for role projects, page objects, fixtures, selectors,
credentials, seed data, and execution commands.

Do not use Playwright to exhaustively test arithmetic or validation combinations
that are more reliable and faster at unit/API level. Playwright should prove the
critical journey and boundary integration.

### Manual testing

Manual cases remain appropriate when automation is disproportionately expensive,
unstable, unsafe, or unable to observe the authoritative outcome.

Examples:

- Payment-provider Dashboard and balance verification
- Connect webhook registration and invoice-finalization timing
- Live-mode payment smoke tests
- Visual clarity and usability judgment
- Email or external-provider rendering
- Spreadsheet inspection of exported files
- Rare dispute, chargeback, or renewal operations
- Hardware, browser-extension, or third-party-admin workflows

A manual test is not undocumented testing. It requires steps, expected results,
environment, evidence, and execution status in the feature system-test document.

## Risk-based coverage

Not every requirement needs every test level. Coverage is selected by risk.

| Change type | Expected minimum coverage |
|---|---|
| Pure backend calculation | Backend unit tests |
| Frontend-only validation/display | Frontend unit/component tests |
| API contract or persistence | Backend unit/service plus API |
| Authorization or tenant isolation | API; Playwright for critical role workflows |
| Critical payment/checkout/enrollment workflow | Unit/API coverage plus focused Playwright or documented blocker/manual gate |
| External-provider timing or financial settlement | Unit/API plus manual provider validation; automate where reliable |
| Bug fix | Regression test at the lowest level that reproduces the defect |

Increase coverage for:

- Financial consequences
- Cross-tenant data exposure
- Irreversible operations
- Authentication and authorization
- High-frequency workflows
- Complex state transitions
- Previously regressed behavior
- Multiple services or external providers

## Software design document (includes unit tests)

A major module or critical workflow should have:

```text
devops/docs/system_docs/SDD/<NN>-<slug>-SDD.md
```

This engineering-owned document covers software design **and** the developer
unit/service/component inventory (previously a separate `*-UT.md`). It records
test paths, focused execution results, and internal logic gaps. It does not make
the QA test engineer responsible for development-phase unit tests.

Required design sections remain architecture, requirement-to-component map, data
model, contracts, authz, workflows, and known gaps. Required unit sections are
purpose/ownership, requirement coverage, backend unit coverage, frontend
unit/component coverage, execution history, and known unit gaps.

## UI system-test document (ST-UI)

A major module or critical workflow should also have:

```text
devops/docs/system_docs/ST-UI/<NN>-<slug>-ST-UI.md
```

This QA-owned document covers **browser journeys** (Playwright), plus manual and
external release gates for the product module. Exhaustive HTTP contract,
authorization, and persistence matrices belong in `ST-API/<service>-ST-API.md`
and `test_st_api` service suites; ST-UI links them for BRD traceability and does
not duplicate API step lists.

Unit-test completion may be a development prerequisite, but unit-test inventories
and commands belong in the module SDD.

Templates: `devops/docs/system_docs/_templates/module-ST-UI-template.md` and
`devops/docs/system_docs/_templates/service-ST-API-template.md`.

## API system-test document (ST-API)

```text
devops/docs/system_docs/ST-API/<service>-ST-API.md
```

QA-owned, **service-aligned** (mirrors `be/app/v1/…` / `test_st_api/tests/<service>/`).
Maps module BRD IDs to pytest specs. Optional legacy `COVERAGE.md` files under
`test_st_api/tests/<service>/` should point here as the canonical QA home.

### Required ST-UI sections

1. Purpose and ownership (UI vs API vs unit homes)
2. Test environments
3. Test data and actor prerequisites
4. Requirement traceability matrix (Playwright/manual cases + ST-API pointer)
5. Detailed UI test cases
6. Automation status (Playwright paths)
7. Manual/external validation
8. Execution history or release evidence
9. Known gaps, blockers, and deferred cases
10. System-test completion assessment

### Traceability matrix template

| BRD ID | Playwright / manual / external cases | API evidence (ST-API / suite) |
|---|---|---|
| XX-01 | XX-ST-001 | `ST-API/<service>-ST-API.md` |

The traceability matrix is timeless. Do not put implementation status, execution
status, evidence dates, or blockers in this matrix.

### Test-case template

```markdown
### XX-ST-001 — Test-case title

- BRD requirements: XX-01, XX-03
- Priority: Critical | High | Medium | Low
- Test level: Playwright | Manual | External
- Release gate: Every release | Major release | Pilot only | Optional

Preconditions:

- Required role, organization, configuration, or external state

Test data:

- Exact values needed to reproduce the scenario

Steps:

1. Action
2. Action

Expected results:

1. Observable result corresponding to each important step

Automation mapping:

- Intended Playwright test path, or the reason the case requires
  Manual or External validation
- Optional one-line ST-API pointer for related HTTP depth
```

Keep steps business-readable. Implementation selectors, fixtures, mocks, and
helper details belong in automated test code or technical test infrastructure.
The test-level field lists every valid or required execution method, including
manual execution when a human tester can perform the case; it is not limited to
automation targets. `Manual` and `External` are separate labels. Use `External`
only when the case requires authoritative behavior or evidence from Stripe or
another system outside the product. Do not use `Manual/External` as a combined label.
Keep cases timeless: do not embed `Planned`, `Partial`, `Automated`, `Blocked`,
dated evidence, current implementation notes, or execution results in an
individual test case. Consolidate those facts at the end of the document.

## Priorities

- **Critical:** financial integrity, security, tenant isolation, authentication,
  irreversible operations, or core workflow unavailable. Blocks release when
  required coverage fails.
- **High:** major workflow or role behavior with significant user impact.
- **Medium:** important secondary behavior with a practical workaround.
- **Low:** cosmetic, informational, or low-risk edge behavior.

Priority describes business risk, not implementation difficulty.

## Automation and execution status

- **Not automated:** manual case exists; no committed automation.
- **Planned:** automation level and target path are identified.
- **Automated:** committed test maps to the case and is run by the documented
  command or CI job.
- **Not suitable:** manual coverage is intentionally retained with rationale.
- **Blocked:** automation or execution cannot proceed because a named dependency
  is unavailable.

These status values belong only in consolidated automation, execution, gap, or
completion sections after the timeless test cases. Do not attach them to the
case definitions or traceability matrix. Do not mark a case Automated merely
because adjacent unit tests exist; the linked test must prove the stated case at
the stated level.

## Test data and environments

Every feature system-test document should identify:

- Local, integration, staging, test-provider, or live environment
- Required organization and role
- Seed scenario or deterministic setup
- External-provider mode/account
- Cleanup expectations
- Whether data can be safely reused

Automated tests should prefer deterministic builders, fixtures, and unique run
identifiers. Manual financial tests should record provider object IDs without
committing secrets or sensitive payment information.

## Evidence

Acceptable evidence includes:

- Committed automated test path and passing command output
- CI job or report reference
- Playwright trace, screenshot, or video when useful
- API response and database assertion captured by an integration test
- Provider object/reference IDs for authorized test-mode validation
- Dated manual execution record with tester and environment

Avoid embedding secrets, access tokens, card details, or personal information in
system-test documents and test artifacts.

## Definition of system-test complete

A BRD requirement is system-test complete when:

1. Its acceptance criteria map to one or more system-test cases.
2. Business logic is covered at the lowest appropriate automated level.
3. API authorization, tenant isolation, contracts, and persistence are covered
   when applicable.
4. Critical browser workflows have Playwright coverage, or an explicit blocker
   and required manual release gate.
5. External-provider outcomes have documented automated or manual evidence.
6. Required tests have passed in the appropriate environment.
7. Remaining gaps are documented and accepted rather than silently omitted.

A module is system-test complete when every in-scope Critical and High
requirement is system-test complete and accepted lower-priority gaps are
documented.

Passing unit tests alone does not make a user story or module system-test complete.

## Definition of done for agents

Before finishing a behavior change, the agent should:

1. Identify the affected BRD IDs, when a BRD exists.
2. Add or update focused tests at the appropriate levels.
3. Add a regression test for a defect when practical.
4. Update the unit-test document for developer-owned coverage and the system-test
   matrix/cases for QA-owned coverage when applicable.
5. Run the most relevant checks.
6. Report tests executed and their results.
7. Report tests not executed and why.
8. Report remaining manual, Playwright, API-suite, or external-validation gaps.

Do not claim a feature is fully tested or system-test complete when required coverage is
missing, deferred, or only manually observed.

## Relationship to release gates

Feature system-test documents define which cases gate:

- Every release
- Major releases
- First organization/pilot rollout
- Production enablement
- Provider live-mode enablement

Critical failed gates block the applicable release or rollout. A deferred test
must include the responsible environment/dependency and the condition for
resuming it.

## Maintaining the strategy

Update this strategy when test layers, QA status terminology, evidence standards,
or completion rules change across the repository. Feature-specific formulas,
roles, workflows, and test cases belong in feature unit-test and system-test
documents, not here.
