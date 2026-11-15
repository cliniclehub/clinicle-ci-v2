# Authorization and Tenant Access — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`02a-authorization-tenant-access-SDD.md`](../SDD/02a-authorization-tenant-access-SDD.md)  
UI system tests: [`02a-authorization-tenant-access-ST-UI.md`](../ST-UI/02a-authorization-tenant-access-ST-UI.md)  
API system tests: [`authorization-ST-API.md`](../ST-API/authorization-ST-API.md), [`roles-ST-API.md`](../ST-API/roles-ST-API.md), [`tenancy-ST-API.md`](../ST-API/tenancy-ST-API.md)

## Purpose

Decide what an authenticated identity may do: permission catalog, system and
custom roles, route/API guards, and strict tenant isolation.

## Business objective

Prevent privilege escalation and cross-tenant data exposure while allowing org
owners to define custom org permission bundles.

## Scope

### In scope

- Permission catalog (`platform.*`, `org.*`)
- System roles: `super_admin`, `org_owner`, `org_admin`, `user`
- Org-scoped custom roles with mix-and-match `org.*` permissions
- API/FE permission checks and unauthorized redirects
- Cross-tenant isolation for reads/writes

### Out of scope

- Authentication and session issuance (02)
- User lifecycle CRUD (04) except role assignment rules

## Actors

- Platform super admin, org owner, org admin, user, custom-role holders

## Business rules

1. Permissions are the authorization unit; roles bundle permissions.
2. System role grants are immutable and re-synced from code (`permissions.py`).
3. `super_admin` is platform-scoped; do **not** add it to org ACLs by default.
4. Only platform super admin may assign `org_owner`.
5. Org admins cannot manage owner accounts; owners may assign org admins.
6. Custom roles cannot grant `platform.*` permissions.
7. Every tenant data access must enforce `organization_id` (or explicit platform scope).

## User stories and completion criteria

### AZ-01 — Enforce permission on protected APIs/UI

### AZ-02 — Manage custom org roles

### AZ-03 — Prevent cross-tenant reads/writes

### AZ-04 — Preserve system-role immutability and owner/admin policy

## Cross-module dependencies

Identity (02), Users (04), all feature modules’ route guards

## Analytics impact

No analytics impact.

## Known product decisions and gaps

- Prefer `has_permission` / `require_permission` over new role allowlists.

## Business sign-off boundary

Correct permission outcomes and tenant isolation for all baseline APIs.
