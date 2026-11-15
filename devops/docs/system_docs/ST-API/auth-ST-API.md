# auth — API System Test Plan

Status: draft (inventory from existing suite)  
Last updated: 2026-09-30

**Location:** `test_st_api/tests/auth/`  
**Runner:** pytest against a running backend (`test_st_api`)  
**UI journeys:** module docs under `devops/docs/system_docs/ST-UI/`

## Purpose and ownership

QA-owned HTTP/API system tests for the `auth` backend surface. Suites prove
contracts, authorization, tenant isolation, and persistence.

Legacy pointer: `test_st_api/tests/auth/COVERAGE.md` (when present) should
continue to reference this file as the canonical QA home.

## Requirement coverage

| Module BRD IDs | Focus | Specs |
|---|---|---|
| IA-01–IA-08 (module 02) | Registration, login, tokens, sessions, history, OAuth complete | see inventory below |

## Spec inventory

- `test_admin_login_history.py`
- `test_admin_sessions.py`
- `test_login.py`
- `test_login_history.py`
- `test_me.py`
- `test_registration.py`
- `test_sessions.py`
- `test_token_lifecycle.py`

## Known gaps

- Keep this inventory current when adding/removing pytest modules.
- Prefer mapping new cases to stable BRD IDs from the owning module BRD.
