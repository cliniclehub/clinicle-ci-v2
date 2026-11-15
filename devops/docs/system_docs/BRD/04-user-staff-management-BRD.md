# User and Staff Management — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`04-user-staff-management-SDD.md`](../SDD/04-user-staff-management-SDD.md)  
UI system tests: [`04-user-staff-management-ST-UI.md`](../ST-UI/04-user-staff-management-ST-UI.md)  
API system tests: [`users-ST-API.md`](../ST-API/users-ST-API.md)

## Purpose

Administer user profiles and membership inside an organization (and platform-wide
user administration for super admins), including role assignment within policy.

## Scope

### In scope

- Platform user list/create/edit (cross-org, permission-gated)
- Org user list/create/edit/delete within tenant
- Self profile (`/users/me`) including verification channel actions
- Role assignment respecting owner/admin/custom-role policy
- Login enablement / lock fields as exposed by services

### Out of scope

- Auth registration/login protocols (02)
- Custom role definition CRUD (02A)

## Actors

Super admin, org owner, org admin, user (self)

## Business rules

1. Users always belong to exactly one `organization_id`.
2. Email unique per organization.
3. Org routes cannot manage `org_owner` accounts except as policy allows;
   only platform may assign owner.
4. Org admins cannot escalate beyond permitted role assignments.
5. Self routes never expose other users’ data.

## User stories

### USR-01 — Platform administers users across orgs
### USR-02 — Org staff administer same-org users
### USR-03 — User manages own profile
### USR-04 — Role assignment follows org role policy

## Analytics impact

No analytics impact.

## Business sign-off boundary

Correct membership, profile updates, and role-assignment policy enforcement.
