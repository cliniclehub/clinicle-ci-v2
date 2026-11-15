# Organization Lifecycle — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`03-organization-lifecycle-BRD.md`](../BRD/03-organization-lifecycle-BRD.md)  
UI system tests: [`03-organization-lifecycle-ST-UI.md`](../ST-UI/03-organization-lifecycle-ST-UI.md)

## Architecture

```text
Platform UI (platform-organizations)
  → /api/v1/organizations (platform + public + org settings routes)
  → Organization model (schema app)
```

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| ORG-01 | `organizations/routes.py`, `services.py`, platform FE | Implemented |
| ORG-02 | public org-by-domain | Implemented |
| ORG-03 | organization-settings FE + restricted update service | Implemented |
| ORG-04 | org fields consumed by public/auth | Implemented |

## Data model

`app.organizations` — see `be/app/v1/organizations/model.py`.

## API contracts

Platform lifecycle, public lookup, org settings updates with permission
`platform.organizations.*` / `org.settings.manage`.

## Authorization

Platform write: `platform.organizations.write`. Org settings: `org.settings.manage`.
Super admin is platform-scoped.

---

## Unit test plan and coverage

```bash
cd test_unit_be && pytest -q tests/v1/organizations
cd test_st_api && pytest -q tests/organizations
```
