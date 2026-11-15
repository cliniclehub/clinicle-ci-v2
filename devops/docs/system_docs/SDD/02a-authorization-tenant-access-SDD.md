# Authorization and Tenant Access — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`02a-authorization-tenant-access-BRD.md`](../BRD/02a-authorization-tenant-access-BRD.md)  
UI system tests: [`02a-authorization-tenant-access-ST-UI.md`](../ST-UI/02a-authorization-tenant-access-ST-UI.md)

## Architecture and boundaries

```text
JWT claims (roles/permissions)
  → auth_helper assert_any_permission / role checks
  → RoleService + permission bootstrap
  → FE middleware + requirePermission
```

Catalog and system grants: `be/app/v1/auth/permissions.py`.

## Requirement-to-component map

| BRD ID | Implementation components | Status/gap |
|---|---|---|
| AZ-01 | `auth_helper`, route Depends, FE middleware | Implemented |
| AZ-02 | `be/app/v1/roles`, org roles UI | Implemented |
| AZ-03 | org_id filters across services; tenancy ST | Implemented + tested |
| AZ-04 | `org_role_policy`, permission bootstrap | Implemented |

## Data model

Roles, role_permissions, user_roles (org-scoped). System roles flagged immutable.

## API contracts

`/api/v1/roles` — list permissions, CRUD custom roles (gated). Feature routes
each assert required permissions.

## Frontend implementation

`organization-roles`, sidebar/middleware permission gates, unauthorized redirect.

## Authorization and tenant isolation

Platform routes use `platform.*`. Org routes use `org.*` and token org id.
Cross-tenant tests live under `test_st_api/tests/tenancy` and `authorization`.

---

## Unit test plan and coverage

| BRD ID | Coverage | Status |
|---|---|---|
| AZ-* | `test_unit_be/tests/v1/roles`, auth helpers | Present |
| AZ-* | `test_st_api/tests/authorization`, `roles`, `tenancy` | Present |

### Focused commands

```bash
cd test_unit_be && pytest -q tests/v1/roles
cd test_st_api && pytest -q tests/authorization tests/roles tests/tenancy
```
