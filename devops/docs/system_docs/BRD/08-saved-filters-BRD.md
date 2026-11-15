# Saved Filters — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`08-saved-filters-SDD.md`](../SDD/08-saved-filters-SDD.md)  
UI system tests: [`08-saved-filters-ST-UI.md`](../ST-UI/08-saved-filters-ST-UI.md)  
API system tests: [`filters-ST-API.md`](../ST-API/filters-ST-API.md)

## Purpose

Let authenticated users persist named list filters for UI tables, scoped to the
user and organization.

## Scope

### In scope

- CRUD for saved filters
- Validation of filter payloads
- Tenant + user isolation

### Out of scope

- Shared org-wide filter libraries (unless later added)
- Server-side query DSL beyond stored JSON

## Actors

Authenticated users

## Business rules

1. Filters belong to `(organization_id, user_id)` (as modeled).
2. Users cannot read/write another user’s filters.
3. Invalid filter payloads are rejected server-side.

## User stories

### FLT-01 — Create/update/delete saved filters
### FLT-02 — List only own filters for the current tenant

## Analytics impact

No analytics impact.

## Business sign-off boundary

Correct persistence and isolation of saved filters.
