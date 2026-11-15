# System documentation

Canonical durable product documentation for this multi-tenant application
baseline. Planning scratchpads stay in `.cursor/plans/`. Engineering rules stay
in `devops/docs/rules/`.

## Why this folder exists

`AI_RULES.md` and `QA_STRATEGY.md` require module BRD / SDD / ST docs under
`devops/docs/system_docs/`. This repository was spun as a platform baseline
(without LMS/commerce domains), so the tree was referenced before it was
created. This folder is that missing home.

## Layout

```text
devops/docs/system_docs/
  BRD/                       # flat module BRDs (numbered filenames)
  SDD/                       # flat module SDDs (design + unit-test inventory)
  ST-UI/                     # module UI system tests (Playwright)
  ST-API/                    # service API system tests (pytest)
  _templates/
```

| Artifact | Who | Proves |
|---|---|---|
| `*-BRD.md` | Product / eng | What the module must do |
| `*-SDD.md` | Engineering | How it is designed; includes developer unit-test plan |
| `*-ST-UI.md` | QA | Browser / Playwright + manual/external gates |
| `*-ST-API.md` | QA | HTTP API suites in `test_st_api` (service-aligned) |

Filenames are unique and sort by module number, e.g.
`01-public-website-BRD.md`, `02a-authorization-tenant-access-BRD.md`.

Do **not** recreate per-module `NN. Module Name/` folders (retired pattern).

## Module register (platform baseline)

| # | Slug | BRD | SDD | ST-UI |
|---|---|---|---|---|
| 01 | `public-website` | [BRD](BRD/01-public-website-BRD.md) | [SDD](SDD/01-public-website-SDD.md) | [ST-UI](ST-UI/01-public-website-ST-UI.md) |
| 02 | `identity-authentication` | [BRD](BRD/02-identity-authentication-BRD.md) | [SDD](SDD/02-identity-authentication-SDD.md) | [ST-UI](ST-UI/02-identity-authentication-ST-UI.md) |
| 02A | `authorization-tenant-access` | [BRD](BRD/02a-authorization-tenant-access-BRD.md) | [SDD](SDD/02a-authorization-tenant-access-SDD.md) | [ST-UI](ST-UI/02a-authorization-tenant-access-ST-UI.md) |
| 03 | `organization-lifecycle` | [BRD](BRD/03-organization-lifecycle-BRD.md) | [SDD](SDD/03-organization-lifecycle-SDD.md) | [ST-UI](ST-UI/03-organization-lifecycle-ST-UI.md) |
| 04 | `user-staff-management` | [BRD](BRD/04-user-staff-management-BRD.md) | [SDD](SDD/04-user-staff-management-SDD.md) | [ST-UI](ST-UI/04-user-staff-management-ST-UI.md) |
| 05 | `media-management` | [BRD](BRD/05-media-management-BRD.md) | [SDD](SDD/05-media-management-SDD.md) | [ST-UI](ST-UI/05-media-management-ST-UI.md) |
| 06 | `email-communications` | [BRD](BRD/06-email-communications-BRD.md) | [SDD](SDD/06-email-communications-SDD.md) | [ST-UI](ST-UI/06-email-communications-ST-UI.md) |
| 07 | `notifications` | [BRD](BRD/07-notifications-BRD.md) | [SDD](SDD/07-notifications-SDD.md) | [ST-UI](ST-UI/07-notifications-ST-UI.md) |
| 08 | `saved-filters` | [BRD](BRD/08-saved-filters-BRD.md) | [SDD](SDD/08-saved-filters-SDD.md) | [ST-UI](ST-UI/08-saved-filters-ST-UI.md) |
| 09 | `platform-operations` | [BRD](BRD/09-platform-operations-BRD.md) | [SDD](SDD/09-platform-operations-SDD.md) | [ST-UI](ST-UI/09-platform-operations-ST-UI.md) |
| 10 | `intelligence-workspace` | [BRD](BRD/10-intelligence-workspace-BRD.md) | [SDD](SDD/10-intelligence-workspace-SDD.md) | [ST-UI](ST-UI/10-intelligence-workspace-ST-UI.md) |

## API system-test register

| Service | ST-API | Pytest suite |
|---|---|---|
| `auth` | [auth-ST-API.md](ST-API/auth-ST-API.md) | `test_st_api/tests/auth/` |
| `authorization` | [authorization-ST-API.md](ST-API/authorization-ST-API.md) | `test_st_api/tests/authorization/` |
| `cron_jobs` | [cron_jobs-ST-API.md](ST-API/cron_jobs-ST-API.md) | `test_st_api/tests/cron_jobs/` |
| `debug` | [debug-ST-API.md](ST-API/debug-ST-API.md) | `test_st_api/tests/debug/` |
| `email_engine` | [email_engine-ST-API.md](ST-API/email_engine-ST-API.md) | `test_st_api/tests/email_engine/` |
| `email_templates` | [email_templates-ST-API.md](ST-API/email_templates-ST-API.md) | `test_st_api/tests/email_templates/` |
| `filters` | [filters-ST-API.md](ST-API/filters-ST-API.md) | `test_st_api/tests/filters/` |
| `media` | [media-ST-API.md](ST-API/media-ST-API.md) | `test_st_api/tests/media/` |
| `notifications` | [notifications-ST-API.md](ST-API/notifications-ST-API.md) | `test_st_api/tests/notifications/` |
| `organizations` | [organizations-ST-API.md](ST-API/organizations-ST-API.md) | `test_st_api/tests/organizations/` |
| `roles` | [roles-ST-API.md](ST-API/roles-ST-API.md) | `test_st_api/tests/roles/` |
| `tenancy` | [tenancy-ST-API.md](ST-API/tenancy-ST-API.md) | `test_st_api/tests/tenancy/` |
| `users` | [users-ST-API.md](ST-API/users-ST-API.md) | `test_st_api/tests/users/` |

## Canonical roles

| Key | Scope | Notes |
|---|---|---|
| `super_admin` | Platform | Full `platform.*` permissions; not an org staff role by default |
| `org_owner` | Organization | Full `org.*`; assignable only by platform super admin |
| `org_admin` | Organization | Full `org.*`; may be assigned by org owners |
| `user` | Organization | Default self-signup / assignable role; no admin catalog permissions |

Authorization is permission-based. Org custom roles may mix `org.*` permissions;
system role grants are immutable.

## Related locations

| Path | Purpose |
|---|---|
| `devops/docs/rules/` | AI / QA engineering standards |
| `devops/docs/req & design/` | Cross-module specs without an approved module owner yet |
| `devops/docs/archive/` | Retired docs only |
| `devops/docs/modules_docs/` | Retired pointer — do not add new module docs |
| `.cursor/plans/` | Implementation plans and architectural scratchpads |
