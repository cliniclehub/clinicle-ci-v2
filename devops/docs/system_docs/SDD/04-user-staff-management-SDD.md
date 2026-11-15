# User and Staff Management — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`04-user-staff-management-BRD.md`](../BRD/04-user-staff-management-BRD.md)  
UI system tests: [`04-user-staff-management-ST-UI.md`](../ST-UI/04-user-staff-management-ST-UI.md)

## Architecture

```text
platform-users / organization-users / settings (self)
  → users_platform_routes | users_org_routes | users_me_routes
  → UserService + org_role_policy + verification services
```

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| USR-01 | `users_platform_routes`, platform FE | Implemented |
| USR-02 | `users_org_routes`, organization-users FE | Implemented |
| USR-03 | `users_me_routes`, settings FE | Implemented |
| USR-04 | `org_role_policy.py` | Implemented |

## Data model

`app.users` + `user_roles`. Unique `(email, organization_id)`.

## Authorization

`platform.users.*`, `org.users.*`. Self endpoints require authenticated subject.

---

## Unit test plan and coverage

```bash
cd test_unit_be && pytest -q tests/v1/users
cd test_st_api && pytest -q tests/users tests/authorization
```
