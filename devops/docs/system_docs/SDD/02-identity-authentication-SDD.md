# Identity and Authentication — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`02-identity-authentication-BRD.md`](../BRD/02-identity-authentication-BRD.md)  
UI system tests: [`02-identity-authentication-ST-UI.md`](../ST-UI/02-identity-authentication-ST-UI.md)

## Architecture and boundaries

```text
FE auth pages / Next OAuth helpers
  → /api/v1/auth (public, me, admin, oauth)
  → Auth services → users, codes, oauth identities, refresh tokens, login attempts
  → JWT access + hashed refresh → HttpOnly cookies → AuthProvider
```

Produces `UserTokenInfo`. Module 02A decides what those claims may do.

## Requirement-to-component map

| BRD ID | Implementation components | Status/gap |
|---|---|---|
| IA-01 | `auth_public_routes` register; user create + default role | Implemented |
| IA-02 | verify/resend email; users/me phone/email verification services | Implemented |
| IA-03 | login + lock/failed-attempt fields | Implemented |
| IA-04 | `oauth_routes` + FE OAuth complete | Implemented |
| IA-05 | forgot/reset password | Implemented |
| IA-06 | refresh/logout token helpers | Implemented |
| IA-07 | `/auth/me/sessions`, `/auth/admin/sessions` | Implemented |
| IA-08 | login-history/statistics me + admin | Implemented |

## Data model

- `app.users` (tenant email unique, verification, lock, login flags)
- verification/reset code tables; `user_oauth_identities`; hashed `refresh_tokens`;
  `login_attempts`; password history as implemented

## API contracts

Public: register, verify-email, resend-verification, login, refresh, logout,
forgot-password, reset-password. OAuth: `POST /auth/oauth/{provider}/complete`.
Me: `/auth/me`, sessions, login-history, login-statistics, verify-token.
Admin: same-org sessions/history routes.

## Frontend implementation

`fe/app/(auth)/` — login, register, verify-email, verify-phone, forgot/reset
password. Cookie helpers and middleware refresh skew.

## Authorization and tenant isolation

All identity records scoped by `organization_id` / domain. Admin auth routes
require org staff permissions/roles for same-org targets only.

## Known implementation gaps

- Align refresh JWT exp vs DB sliding expiry if both are present.
- Expand negative E2E for lockout and OAuth conflict cases.

---

## Unit test plan and coverage

### Requirement coverage

| BRD ID | Developer-owned unit coverage | Status |
|---|---|---|
| IA-* | `test_unit_be/tests/v1/auth` (and related) | Present / expand |
| IA-* | `test_st_api/tests/auth` | Present |

### Focused commands

```bash
cd test_unit_be && pytest -q tests/v1/auth
# ST API
cd test_st_api && pytest -q tests/auth
```

### Known unit-test gaps

- OAuth provider edge cases and enumeration-safe messaging depth
