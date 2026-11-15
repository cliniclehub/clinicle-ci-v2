# Email Communications — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`06-email-communications-SDD.md`](../SDD/06-email-communications-SDD.md)  
UI system tests: [`06-email-communications-ST-UI.md`](../ST-UI/06-email-communications-ST-UI.md)  
API system tests: [`email_templates-ST-API.md`](../ST-API/email_templates-ST-API.md), [`email_engine-ST-API.md`](../ST-API/email_engine-ST-API.md)

## Purpose

Tenant email templates and transactional email engine: customize templates,
enqueue messages, process the queue via cron, and observe delivery logs.

## Scope

### In scope

- Default templates seeded by `template_key`
- Org template customization / restore default
- Queue, render, send via configured provider (e.g. MailerSend)
- Recipient gating and webhook handling as implemented
- Org email manager UI

### Out of scope

- Marketing automation / audience sync products
- Full multi-language template columns (noted gap in FE i18n README)

## Actors

Users with `org.email.manage`; system cron for queue processing

## Business rules

1. Templates and queue rows are organization-scoped.
2. New product emails add a `template_key` to `default_templates.json` and enqueue via the engine.
3. Queue processing is batched per org (cron `email-queue`).
4. Rendering must not leak another tenant’s template content.

## User stories

### EML-01 — Manage org email templates
### EML-02 — Enqueue transactional email
### EML-03 — Process queue and record outcomes
### EML-04 — Inspect email engine activity/logs (as exposed)

## Analytics impact

No analytics impact beyond operational send metrics.

## Business sign-off boundary

Correct tenant templates and reliable transactional enqueue/send path.
