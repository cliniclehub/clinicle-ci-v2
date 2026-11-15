# Notifications — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`07-notifications-BRD.md`](../BRD/07-notifications-BRD.md)  
UI system tests: [`07-notifications-ST-UI.md`](../ST-UI/07-notifications-ST-UI.md)

## Architecture

```text
organization-notifications / notifications
  → /api/v1/notifications
  → notification services + cron notification-dispatch / notification-reconcile
```

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| NTF-01 | notifications routes/services + FE | Implemented |
| NTF-02 | user notifications FE | Implemented |
| NTF-03 | cron definitions + services | Implemented |

---

## Unit test plan and coverage

```bash
cd test_unit_be && pytest -q tests/v1/notifications
cd test_st_api && pytest -q tests/notifications
```
