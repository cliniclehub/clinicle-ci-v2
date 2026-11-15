# Media Management — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`05-media-management-BRD.md`](../BRD/05-media-management-BRD.md)  
UI system tests: [`05-media-management-ST-UI.md`](../ST-UI/05-media-management-ST-UI.md)

## Architecture

```text
organization-media-manager / platform-media-manager
  → /api/v1/media
  → MediaAssetService, MultipartUploadService, MediaAccessService, reconcile
  → local MEDIA_STORAGE or R2
```

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| MED-01 | multipart routes/services | Implemented |
| MED-02 | asset CRUD routes | Implemented |
| MED-03 | sign-access | Implemented |
| MED-04 | media_reconcile_service | Implemented |

## Data model

`media_assets` (and related usage/reconcile structures as present).

## Authorization

`org.media.manage` or `platform.settings.manage` via `assert_any_permission`.

---

## Unit test plan and coverage

```bash
cd test_unit_be && pytest -q tests/v1/media
cd test_st_api && pytest -q tests/media
```
