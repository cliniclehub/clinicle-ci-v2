# User and Staff Management — UI System Test Plan

Status: draft  
Last updated: 2026-09-30  
Business requirements: [`04-user-staff-management-BRD.md`](../BRD/04-user-staff-management-BRD.md)  
Design: [`04-user-staff-management-SDD.md`](../SDD/04-user-staff-management-SDD.md)

## Requirement traceability

| BRD ID | UI cases | API evidence |
|---|---|---|
| USR-01 | USR-ST-001 | users-ST-API |
| USR-02 | USR-ST-002 | users-ST-API |
| USR-03 | USR-ST-003 | users-ST-API |

### USR-ST-001 — Platform users list/create
### USR-ST-002 — Organization users list/create
### USR-ST-003 — Self settings profile

## Automation status

| Area | Path | Status |
|---|---|---|
| Super-admin / org flows | `test_st_ui/tests/super-admin`, matrix | Baseline |
| Org users (USR-ST-002) | `test_st_ui/tests/org-admin/typical-org.spec.ts` | Baseline smoke on Test Org A |
