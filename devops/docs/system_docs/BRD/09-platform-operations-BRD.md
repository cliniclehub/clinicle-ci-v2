# Platform Operations — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`09-platform-operations-SDD.md`](../SDD/09-platform-operations-SDD.md)  
UI system tests: [`09-platform-operations-ST-UI.md`](../ST-UI/09-platform-operations-ST-UI.md)  
API system tests: [`cron_jobs-ST-API.md`](../ST-API/cron_jobs-ST-API.md), [`debug-ST-API.md`](../ST-API/debug-ST-API.md)

## Purpose

Platform operator tooling: cron job settings/runs, platform settings, API tools,
and debug endpoints restricted to platform authority.

## Scope

### In scope

- Cron definitions (email-queue, auth-cleanup, notification-dispatch/reconcile,
  cron-history-cleanup, etc.)
- Manual trigger / settings / run history as implemented
- Platform settings and API tools pages
- Debug routes hardened for non-production or super-admin only

### Out of scope

- Infrastructure provisioning (Render/GHCR) documentation beyond devops deploy
- Application feature domains

## Actors

Platform super admin (`platform.settings.manage` / super_admin)

## Business rules

1. Cron and debug surfaces are not available to org staff by default.
2. Job runs are recorded; history cleanup respects retention settings.
3. Manual triggers must be authorized and auditable.

## User stories

### OPS-01 — View and configure cron jobs
### OPS-02 — Inspect run history / trigger allowed jobs
### OPS-03 — Use platform settings / API tools safely
### OPS-04 — Debug endpoints reject unauthorized callers

## Analytics impact

No analytics impact.

## Business sign-off boundary

Operator-only access and reliable scheduled job control.
