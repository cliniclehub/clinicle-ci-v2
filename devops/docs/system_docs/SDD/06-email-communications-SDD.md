# Email Communications — Software Design Document

Status: current-state design  
Last updated: 2026-09-30  
Business requirements: [`06-email-communications-BRD.md`](../BRD/06-email-communications-BRD.md)  
UI system tests: [`06-email-communications-ST-UI.md`](../ST-UI/06-email-communications-ST-UI.md)

## Architecture

```text
organization-email-manager
  → /api/v1/email-templates + /api/v1/email-engine
  → template services, email_renderer, recipient_gate, provider
  → cron email-queue
```

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| EML-01 | `email_templates/*`, FE email manager | Implemented |
| EML-02 | email_engine enqueue services | Implemented |
| EML-03 | cron job + engine send | Implemented |
| EML-04 | engine routes/reporting | Implemented |

## Authorization

`org.email.manage` (and platform equivalents where exposed).

---

## Unit test plan and coverage

```bash
cd test_unit_be && pytest -q tests/v1/email_templates tests/v1/email_engine
cd test_st_api && pytest -q tests/email_templates tests/email_engine
```
