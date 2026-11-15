# Saved Filters — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`08-saved-filters-BRD.md`](../BRD/08-saved-filters-BRD.md)  
UI system tests: [`08-saved-filters-ST-UI.md`](../ST-UI/08-saved-filters-ST-UI.md)

## Architecture

```text
FE table filter UX → /api/v1/filters → SavedFilter model/services
```

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| FLT-01 | `filters/routes.py`, `services.py` | Implemented |
| FLT-02 | user/org scoping in queries | Implemented |

---

## Unit test plan and coverage

```bash
cd test_unit_be && pytest -q tests/v1/filters
cd test_st_api && pytest -q tests/filters
```
