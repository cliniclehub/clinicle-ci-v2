# media — API System Test Plan

Status: draft (inventory from existing suite)  
Last updated: 2026-09-30

**Location:** `test_st_api/tests/media/`  
**Runner:** pytest against a running backend (`test_st_api`)  
**UI journeys:** module docs under `devops/docs/system_docs/ST-UI/`

## Purpose and ownership

QA-owned HTTP/API system tests for the `media` backend surface. Suites prove
contracts, authorization, tenant isolation, and persistence.

Legacy pointer: `test_st_api/tests/media/COVERAGE.md` (when present) should
continue to reference this file as the canonical QA home.

## Requirement coverage

| Module BRD IDs | Focus | Specs |
|---|---|---|
| MED-01–MED-04 (module 05) | Asset lifecycle, read/security, route security matrix | see inventory below |

## Spec inventory

- `test_asset_lifecycle_and_isolation.py`
- `test_read_and_security.py`
- `test_route_security_matrix.py`

## Known gaps

- Keep this inventory current when adding/removing pytest modules.
- Prefer mapping new cases to stable BRD IDs from the owning module BRD.
