# Platform Operations — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`09-platform-operations-BRD.md`](../BRD/09-platform-operations-BRD.md)  
UI system tests: [`09-platform-operations-ST-UI.md`](../ST-UI/09-platform-operations-ST-UI.md)

## Architecture

```text
platform-cron-jobs / platform-settings / platform-api-tools
  → /api/v1/cron-jobs , /api/v1/debug
  → scheduler/runner + cron services
```

Job catalog: `be/app/v1/cron_jobs/constants.py`.

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| OPS-01–02 | cron_jobs routes/services/FE | Implemented |
| OPS-03 | platform settings/API tools FE | Implemented |
| OPS-04 | debug routes + ST security matrix | Implemented |

---

## Unit test plan and coverage

```bash
cd test_unit_be && pytest -q tests/v1/cron_jobs
cd test_st_api && pytest -q tests/cron_jobs tests/debug
```
