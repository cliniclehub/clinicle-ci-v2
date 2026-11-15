# [service_name] — API System Test Plan

Status: draft  
Last updated: YYYY-MM-DD  

**Location:** `test_st_api/tests/<service>/`  
**Runner:** pytest (`make test-st-api MODULE=<service>`)  
**UI journeys:** module docs under `devops/docs/system_docs/ST-UI/`

## Purpose and ownership

QA-owned HTTP/API system tests for this backend service package. Suites prove
contracts, authorization, tenant isolation, and persistence against a running
backend.

## Requirement coverage

| Module BRD IDs | Focus | Specs |
|---|---|---|
| XX-01 | [Focus] | `test_*.py` |

## Known gaps
