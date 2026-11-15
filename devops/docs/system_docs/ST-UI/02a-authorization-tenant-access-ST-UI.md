# Authorization and Tenant Access — UI System Test Plan

Status: draft  
Last updated: 2026-09-30  
Business requirements: [`02a-authorization-tenant-access-BRD.md`](../BRD/02a-authorization-tenant-access-BRD.md)  
Design: [`02a-authorization-tenant-access-SDD.md`](../SDD/02a-authorization-tenant-access-SDD.md)

## Purpose and ownership

Browser proof of role-gated navigation and unauthorized redirects. Exhaustive
authz matrices stay in ST-API.

## Requirement traceability

| BRD ID | UI cases | API evidence |
|---|---|---|
| AZ-01 | AZ-ST-001 | authorization-ST-API |
| AZ-02 | AZ-ST-002 | roles-ST-API |
| AZ-03 | — (API primary) | tenancy-ST-API |

### AZ-ST-001 — Blocked role redirected to unauthorized

- Priority: Critical — Playwright (`test_st_ui/tests/security` / matrix)

### AZ-ST-002 — Org owner/admin can open roles manager

- Priority: High — Playwright

## Automation status

| Area | Path | Status |
|---|---|---|
| Security / matrix | `test_st_ui/tests/security`, `tests/matrix` | Existing |
