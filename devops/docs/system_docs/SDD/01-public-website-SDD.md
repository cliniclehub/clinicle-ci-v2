# Public Website — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`01-public-website-BRD.md`](../BRD/01-public-website-BRD.md)  
UI system tests: [`01-public-website-ST-UI.md`](../ST-UI/01-public-website-ST-UI.md)

## Purpose

Describe how tenant public pages are served from Next.js public routes and
organization public fields.

## Architecture and boundaries

```text
Browser (tenant host)
  → Next.js (public) route group: site-landing, contact, terms, privacy, unauthorized
  → optional public org API / server fetch by domain
  → organizations table fields (landing_page_html, site_theme, legal, emails)
```

## Requirement-to-component map

| BRD ID | Implementation components | Status/gap |
|---|---|---|
| PW-01 | `fe/app/(public)/site-landing`, org domain resolution | Implemented |
| PW-02 | `fe/app/(public)/terms-of-use`, `privacy-policy` | Implemented |
| PW-03 | `fe/app/(public)/contact` | Implemented |
| PW-04 | `fe/app/(public)/unauthorized` | Implemented |

## Data model

Organization fields: `landing_page_html`, `site_theme`, `terms_of_use`,
`privacy_policy`, contact emails, logos, `domain`, `is_active`.

## API contracts

Public org lookup by domain (organizations public routes). Mutations stay under
authenticated org/platform organization APIs (module 03).

## Frontend implementation

Route group `fe/app/(public)/`. Root/marketing entry may redirect or compose
with tenant landing.

## Authorization and tenant isolation

No auth required for public pages. Isolation is hostname/domain based. Never
fall back to another organization’s content on miss.

## Known implementation gaps

- Playwright module folder for public website journeys may still be thin/smoke.

---

## Unit test plan and coverage

### Requirement coverage

| BRD ID | Developer-owned unit coverage | Status |
|---|---|---|
| PW-01–PW-04 | FE component/smoke where present; BE org public service tests | Partial |

### Backend unit and service coverage

- Organization public-by-domain behavior in `test_unit_be` / org services

### Frontend unit and component coverage

- Prefer focused component tests for legal/landing rendering helpers when added

### Focused commands

```bash
# from repo root / packages as applicable
cd test_unit_be && pytest -q tests/v1/organizations -k public
cd test_st_api && make test-st-api MODULE=organizations  # or project equivalent
```

### Known unit-test gaps

- Full visual regression for themed landing is not required at unit level.
