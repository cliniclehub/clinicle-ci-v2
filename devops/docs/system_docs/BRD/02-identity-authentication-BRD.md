# Identity and Authentication — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`02-identity-authentication-SDD.md`](../SDD/02-identity-authentication-SDD.md)  
UI system tests: [`02-identity-authentication-ST-UI.md`](../ST-UI/02-identity-authentication-ST-UI.md)  
API system tests: [`auth-ST-API.md`](../ST-API/auth-ST-API.md)

## Purpose

Establish who a user is within one organization and maintain a trustworthy
signed-in session. Covers registration, verification, password and OAuth login,
recovery, tokens, logout, sessions, and login history.

Authorization (what claims may do) is module 02A.

## Business objective

Provide secure, tenant-scoped identity so every authenticated request carries a
reliable organization and user context.

## Scope

### In scope

- Tenant-aware registration with default `user` role assignment
- Email verification; optional org-enforced phone verification
- Password login, Google OAuth complete flow, password recovery/change
- Access/refresh tokens, cookies, logout, session list/revoke
- Self login history/statistics; org-admin session/history views for same-org users
- Account lock / failed-attempt handling

### Out of scope

- Permission catalogs, custom roles, route ACLs (02A)
- Platform/org user CRUD beyond identity fields (04)
- Email provider internals beyond enqueue handoff (06)

## Actors

- Visitor, authenticated user, org admin/owner (session oversight), Google IdP,
  email/SMS providers

## Business rules

1. Email uniqueness is case-insensitive **per organization**, not global.
2. Registration requires an active tenant and strong password; new accounts start
   unverified and receive the system `user` role.
3. Password login requires verified email (when policy requires), login-enabled
   and unlocked account, and valid credentials.
4. Verification/reset codes are single-use, expiring, tenant-scoped, rate-limited.
5. Password reset/change revokes all refresh sessions for the account.
6. Google OAuth subject uniqueness is **per organization**.
7. Access tokens are short-lived; refresh sessions store token hashes only.
8. Failure responses limit account enumeration where practical.
9. Auth return URLs accept only approved internal paths.

## User stories and completion criteria

### IA-01 — Register for the correct organization

As a visitor, I want to create an account on the tenant I am visiting.

### IA-02 — Verify email and optional phone

As a user, I want to prove control of my contact channels.

### IA-03 — Sign in with password

As a verified user, I want a secure session.

### IA-04 — Sign in or register with Google

As a visitor, I want Google sign-in without unsafe cross-tenant identity merge.

### IA-05 — Recover or change password

As a user, I want safe password recovery and authenticated change.

### IA-06 — Maintain and refresh sessions

As a signed-in user, I want short-lived access with revocable refresh sessions.

### IA-07 — Review and revoke sessions

As a user (or org admin for a same-org user), I want to inspect and revoke sessions.

### IA-08 — Inspect login history

As a user (or org admin for a same-org user), I want privacy-limited login history.

## Cross-module dependencies

- Users (profile fields), Organizations (domain, phone enforcement), Email (codes),
  Authorization (claims interpretation)

## Analytics impact

No analytics impact beyond optional security/ops logging. Login attempts are
security audit data, not product BI facts.

## Known product decisions and gaps

- Default self-signup role is `user` (not LMS `student`).
- Refresh sliding vs fixed expiry policy must stay coherent across JWT, DB, and cookies.

## Business sign-off boundary

Tenant-correct identity, session security, and verification/recovery safety.
