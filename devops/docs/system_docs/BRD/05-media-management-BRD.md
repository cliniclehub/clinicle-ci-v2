# Media Management — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`05-media-management-SDD.md`](../SDD/05-media-management-SDD.md)  
UI system tests: [`05-media-management-ST-UI.md`](../ST-UI/05-media-management-ST-UI.md)  
API system tests: [`media-ST-API.md`](../ST-API/media-ST-API.md)

## Purpose

Tenant media library for uploading, listing, renaming, deleting, and securely
accessing objects (local disk or Cloudflare R2), including multipart upload and
library reconcile.

## Scope

### In scope

- Org and platform media manager UIs
- Asset metadata in DB with `organization_id`
- Presigned multipart upload lifecycle
- Signed access URLs for private objects
- Reconcile orphaned/missing objects

### Out of scope

- CDN product configuration outside app helpers
- Non-media file systems (email attachments as first-class assets)

## Actors

Users with `org.media.manage` or `platform.settings.manage`

## Business rules

1. Assets are organization-scoped; no cross-tenant listing or signing.
2. Upload keys must validate to the caller’s tenant prefix rules.
3. Signed access is time-limited and object-scoped.
4. Delete removes DB row and best-effort storage object.
5. Platform media manager uses platform permission, still tenant-aware for target org context as implemented.

## User stories

### MED-01 — Upload media via multipart flow
### MED-02 — List/rename/delete library assets
### MED-03 — Sign temporary access to a private object
### MED-04 — Reconcile library vs storage

## Analytics impact

No analytics impact.

## Business sign-off boundary

Secure tenant-isolated media lifecycle.
