# organizations — API System Test Plan

Status: draft (inventory from existing suite)  
Last updated: 2026-09-30

**Location:** `test_st_api/tests/organizations/`  
**Runner:** pytest against a running backend (`test_st_api`)  
**UI journeys:** module docs under `devops/docs/system_docs/ST-UI/`

## Purpose and ownership

QA-owned HTTP/API system tests for the `organizations` backend surface. Suites prove
contracts, authorization, tenant isolation, and persistence.

Legacy pointer: `test_st_api/tests/organizations/COVERAGE.md` (when present) should
continue to reference this file as the canonical QA home.

## Requirement coverage

| Module BRD IDs | Focus | Specs |
|---|---|---|
| ORG-01–ORG-04 (module 03); PW-* public (module 01) | Platform lifecycle, public, domain/route security matrices | see inventory below |

## Spec inventory

- `test_domain_route_security.py`
- `test_platform_lifecycle.py`
- `test_public.py`
- `test_route_security_matrix.py`
- `test_my_organization.py` (typical-org happy path on Test Org A)

## Known gaps

- Keep this inventory current when adding/removing pytest modules.
- Prefer mapping new cases to stable BRD IDs from the owning module BRD.
