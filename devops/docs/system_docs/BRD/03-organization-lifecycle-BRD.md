# Organization Lifecycle — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`03-organization-lifecycle-SDD.md`](../SDD/03-organization-lifecycle-SDD.md)  
UI system tests: [`03-organization-lifecycle-ST-UI.md`](../ST-UI/03-organization-lifecycle-ST-UI.md)  
API system tests: [`organizations-ST-API.md`](../ST-API/organizations-ST-API.md)

## Purpose

Provision and manage tenant organizations: identity (name/domain), activation,
branding, legal/contact, timezone, and org settings used by the rest of the
platform.

## Scope

### In scope

- Platform create/update/list/deactivate organizations
- Unique name and domain
- Branding assets URLs, theme, landing HTML, tracking scripts
- Legal text, contact emails, address, timezone
- Org admin settings for same-tenant fields they are allowed to change
- Phone-validation enforcement flag

### Out of scope

- User membership CRUD (04)
- DNS/registrar automation details beyond documented helpers

## Actors

Platform super admin; org owner/admin (limited settings)

## Business rules

1. Domain and name are unique platform-wide.
2. Hostname routing depends on `domain` + `is_active`.
3. Org admins cannot change platform-only fields reserved to super admin (see
   service restrictions).
4. Tenant data for other modules keys off `organizations.id`.

## User stories

### ORG-01 — Platform creates and maintains organizations
### ORG-02 — Resolve organization by domain for public/auth flows
### ORG-03 — Org staff update allowed site settings
### ORG-04 — Branding and legal content available to public/auth UX

## Analytics impact

No analytics impact for baseline org CRUD beyond operational audit logs.

## Business sign-off boundary

Correct provisioning, unique domain, and safe settings boundaries.
