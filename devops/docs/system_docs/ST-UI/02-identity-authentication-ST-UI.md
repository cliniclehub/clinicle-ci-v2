# Identity and Authentication — UI System Test Plan

Status: draft  
Last updated: 2026-09-30  
Business requirements: [`02-identity-authentication-BRD.md`](../BRD/02-identity-authentication-BRD.md)  
Design: [`02-identity-authentication-SDD.md`](../SDD/02-identity-authentication-SDD.md)

## Purpose and ownership

Browser journeys for register, verify, login, logout, and recovery.

| Concern | Home |
|---|---|
| HTTP auth contracts | `ST-API/auth-ST-API.md` |
| Unit tests | Module SDD |

## Requirement traceability

| BRD ID | Playwright / manual / external cases | API evidence |
|---|---|---|
| IA-01 | IA-ST-001 | auth-ST-API |
| IA-03 | IA-ST-002 | auth-ST-API |
| IA-05 | IA-ST-003 | auth-ST-API |
| IA-06 | IA-ST-004 | auth-ST-API |

## Detailed test cases (UI)

### IA-ST-001 — Register and verify email

- BRD: IA-01, IA-02 — Priority: Critical — Playwright

### IA-ST-002 — Password login and reach authenticated shell

- BRD: IA-03 — Priority: Critical — Playwright

### IA-ST-003 — Forgot/reset password

- BRD: IA-05 — Priority: High — Playwright | Manual (email inbox)

### IA-ST-004 — Logout ends protected access

- BRD: IA-06 — Priority: Critical — Playwright

## Automation status (Playwright)

| Area | Path | Status |
|---|---|---|
| Auth project | `test_st_ui/tests/auth` | Existing |
| Module folder | `test_modules/02-identity-authentication/` | Optional expansion |

## System-test completion assessment

Core auth UI coverage exists under role/auth projects; keep ST-API as depth for
matrices.
