# Organization Lifecycle — UI System Test Plan

Status: draft  
Last updated: 2026-09-30  
Business requirements: [`03-organization-lifecycle-BRD.md`](../BRD/03-organization-lifecycle-BRD.md)  
Design: [`03-organization-lifecycle-SDD.md`](../SDD/03-organization-lifecycle-SDD.md)

## Requirement traceability

| BRD ID | UI cases | API evidence |
|---|---|---|
| ORG-01 | ORG-ST-001 | organizations-ST-API |
| ORG-03 | ORG-ST-002 | organizations-ST-API |

### ORG-ST-001 — Super admin creates/edits organization
### ORG-ST-002 — Org admin opens organization settings

## Automation status

| Area | Path | Status |
|---|---|---|
| Super-admin | `test_st_ui/tests/super-admin` | Existing baseline |
| Org settings (ORG-ST-002) | `test_st_ui/tests/org-admin/typical-org.spec.ts` | Baseline smoke on Test Org A |
