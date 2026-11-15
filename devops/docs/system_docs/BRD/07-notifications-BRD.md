# Notifications — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`07-notifications-SDD.md`](../SDD/07-notifications-SDD.md)  
UI system tests: [`07-notifications-ST-UI.md`](../ST-UI/07-notifications-ST-UI.md)  
API system tests: [`notifications-ST-API.md`](../ST-API/notifications-ST-API.md)

## Purpose

In-app and scheduled notification configuration, user notification inbox, and
dispatch/reconcile jobs that may hand off to email.

## Scope

### In scope

- Org notification settings and activity UIs
- User notifications page
- Dispatch and reconcile cron jobs
- Permission `org.notifications.manage`

### Out of scope

- Push/mobile providers beyond what is implemented
- Marketing campaigns

## Actors

Org notification managers; end users reading their inbox; cron

## Business rules

1. Notification data is organization- and user-scoped.
2. Dispatch claims work items safely (no double-send races).
3. Users only see their own notification rows.

## User stories

### NTF-01 — Configure org notification behavior
### NTF-02 — User reads/manages personal notifications
### NTF-03 — Scheduled dispatch/reconcile runs correctly

## Analytics impact

No analytics impact.

## Business sign-off boundary

Correct visibility and reliable dispatch without cross-tenant leakage.
