# Live API acceptance tests

This pytest suite validates the deployed Clinicle Intelligence API through its public routes. Coverage is limited to authentication, users, canonical roles, organizations, filters, templates and email delivery records, notifications, media assets, authorization, and tenant isolation.

Copy `.env.example` to `.env` (or share `test_st_ui/.env`) and supply test-only `ST_*` accounts for **Test Org A** (`ORG_DOMAIN=testorg-a.clinicle-ci.local`). Tenant-boundary cases also require **Test Org B** (`ST_TENANT_B_*`). Prefer `ST_*` (system test); legacy `E2E_*` / `API_TEST_TENANT_B_*` names remain as migration fallbacks. Oracle SQL uses schema `ST_DATABASE_SCHEMA` / `DB_SCHEMA` (local default `ci`).

Do not point the suite at Allure — that org is for stable manual use. The target stack must already be running; tests do not start services. Run `npm run seed:bootstrap` in `test_st_ui` to provision disposable Test Org A/B personas.

Run from the repository root with `make test-st-api`, or use `python3 -m pytest test_st_api -q`. Use `python3 -m pytest test_st_api --collect-only -q` for a credential-free structural check.

The suite may create and delete records in the target environment. Point it only at disposable local or staging tenants, never production. Payment, commerce, learning, enrollment, and other downstream product workflows are deliberately outside this suite.
