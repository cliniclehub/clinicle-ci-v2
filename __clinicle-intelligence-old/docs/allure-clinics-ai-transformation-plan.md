---
type: plan
status: draft
tags: [allure-clinics, ai-transformation, patient-journey, contact-center, quality-supervisor, revenue-optimization, doctor-copilot, zatca-compliance, vat-audit, employee-copilot, kpi-intelligence, inventory-procurement, financial-controller, clinicle-intelligence, cowagent]
relatedTo: [cowagent, clinicle-intelligence, composio, meeting-assistant, workflow-engine, patient-360]
---

# Allure Clinics AI Transformation — Build Plan

Status: draft, plan-only (no implementation yet)
Target: build as new modules/agents inside this platform (CowAgent / Clinicle Intelligence), reusing existing infra rather than parallel systems.

## Why this sequencing

Patient Journey / Patient 360 (#4) is the foundational data model. Quality Supervisor (#1), Revenue Optimization (#2), Doctor Copilot (#6), and Management KPI Intelligence (#7) all read from "what happened to this patient and when" — building them before Patient 360 exists means either duplicating that data model four times or bolting it on later as a breaking migration. It goes first, even though the source doc doesn't rank it above the other P1s.

Contact Center (#3) and VAT/ZATCA (#8) are largely independent of Patient 360 and of each other — they can run in parallel with it once started, gated only by their own external integrations (see Open Questions).

The four P2s (#5, #7, #9, #10) are lower business urgency per the source doc and mostly consume data the P1 phase produces (KPI Intelligence needs Patient 360 + Revenue data; Financial Controller needs the VAT/ZATCA transaction pipeline; Inventory needs Patient 360's appointment/treatment-mix data).

## Phase 0 — Patient Journey AI / Patient 360 (#4, P1, foundational)

**What it is:** the canonical patient record and journey state machine — inquiry → booking → consultation → treatment → follow-up → feedback → recall → re-engagement — that #1, #2, #6, #7, #9 all read or write.

**Reuses:** `agent/tenancy/` for org-scoped multi-clinic isolation if Allure has multiple branches; `agent/workspace/` store patterns (SQLite-per-workspace, same shape as `meeting_store.py`/`team_store.py`) for a new `patient_store.py`; the existing audit trail (`agent/audit/`) for tamper-evident logging of every journey-stage transition, matching how Sovereignty already logs governed actions.

**New infra:**
- `agent/workspace/patient_store.py` — patient record, journey-stage enum, timeline of events (call, WhatsApp msg, booking, visit, treatment note, invoice, feedback), each event sourced from whichever channel produced it (Contact Center, CRM sync, Doctor Copilot documentation, VAT pipeline).
- A journey-stage state machine with allowed transitions (mirrors the workflow engine's `logic.condition` node pattern already built for Workflows — reuse the DAG/branching primitives from `agent/tools/workflows/engine.py` rather than writing a second state-machine implementation).
- A "Patient 360" view surface (new nav page, same pattern as Meetings/Analytics) showing timeline + current stage + next recommended action.

**Data/integration needs:** Allure's CRM as source of truth for existing patient records (via Composio if the CRM has a Composio toolkit; otherwise a one-off import connector — flag in Open Questions). No new external dependency to start the data model itself; it can run on data captured going forward from Contact Center + Doctor Copilot even before a full CRM backfill exists.

## Phase 1 — P1 use cases (parallel once Phase 0's store exists)

### #3 AI Contact Center — Voice & WhatsApp
**Reuses:** Composio for the WhatsApp Business integration (standing policy: connectors always through Composio, never direct SDK) and for whichever CRM/telephony toolkit Composio exposes; the Meeting Assistant's transcript-ingestion + anti-hallucination extraction pattern (`agent/tools/meetings/extraction_service.py`) is the right template for turning a call/WhatsApp transcript into structured intent (booking, reschedule, inquiry) rather than trusting a raw LLM completion; the scheduler (`agent/tools/scheduler/`) for reminders/confirmations, matching how meeting bot-join dispatch already runs on a background poll loop.
**New infra:** a voice channel handler (need a voice/telephony Composio toolkit or a dedicated ASR/TTS pipeline — open question, see below); a WhatsApp inbound/outbound handler under `channel/` alongside the existing Feishu/DingTalk/WeChat channel implementations (same shape); intent classification + escalation-to-human routing.
**Writes to:** Patient 360 (every contact-center interaction is a journey event).
**Open questions:** which voice/telephony provider does Allure use (needed for Composio toolkit selection or a fallback direct integration); WhatsApp Business API account ownership and Composio toolkit availability for it.

### #1 AI Quality Supervisor
**Reuses:** the same anti-hallucination extraction pattern as Meetings for scoring calls/WhatsApp/CRM transcripts against Allure's service standards; the audit/Sovereignty infra for storing "why was this interaction flagged" evidence tamper-evidently, since QA scoring will be contested by employees and needs a defensible trail.
**New infra:** a scoring rubric config (service standard checklist, editable per clinic), a sentiment/compliance classifier tool, an employee-facing dashboard (reuses Analytics page patterns) surfacing per-agent/per-channel quality trends.
**Data needs:** depends entirely on #3 (Contact Center) and #4 (in-clinic meeting capture, already built) being live — this use case has no data to analyze until those channels exist. In-clinic "meeting" interactions can reuse the *existing* Meeting Assistant unmodified; this is largely a new analysis layer over data the platform already ingests once Contact Center ships.

### #2 AI Revenue Optimization Engine
**Reuses:** Patient 360's journey-stage data directly (no-show = a booking event with no matching visit event; lost lead = inquiry stage with no progression after N days; reactivation candidates = patients whose last visit exceeds their treatment's typical recall interval); the workflow engine for the "next-best-action" trigger logic (a `logic.condition` DAG evaluating patient state → recommended outreach, dispatched as a scheduled task); Contact Center for executing the recommended outreach.
**New infra:** a recommendation-scoring tool (rules-based v1, e.g. days-since-last-visit thresholds per treatment type; ML-based ranking is a later iteration, not v1) and a revenue-opportunity queue surfaced to staff (or auto-dispatched through Contact Center once trusted).
**Data needs:** treatment-type recall intervals and empty-slot/calendar data — needs the clinic's scheduling system, likely the same CRM/calendar integration Contact Center needs.

### #6 Doctor AI Copilot
**Reuses:** the Knowledge Base (`agent/knowledge/`) for protocol/treatment-plan reference lookup; Meeting Assistant's transcript → structured extraction for turning consultation audio/notes into documentation; Patient 360 for pulling history/prior treatments into the doctor-facing summary.
**New infra:** a consultation-documentation tool (dictation or structured-note capture → treatment note written to Patient 360), a "patient insights" panel for doctors (retention/utilization stats scoped to their own patients — reuses Analytics' per-agent breakdown pattern, scoped by doctor instead of by AI agent).
**Data needs:** none new beyond Patient 360 and Knowledge Base being populated with Allure's actual protocols/SOPs (a content/upload task, not an integration).

### #8 VAT Audit & ZATCA Compliance AI
**Independent of Patient 360.** Reuses Composio for whichever accounting/ERP system Allure uses (if it has a Composio toolkit) to pull transactions/invoices; the anti-hallucination re-verification pattern from Meetings (never trust an LLM's VAT-classification claim directly — re-verify against the actual invoice line items in code, same discipline as re-verifying meeting-owner claims against real participants) is directly applicable here given this touches real tax compliance.
**New infra:** an invoice/transaction ingestion tool, a VAT classification rules engine (Saudi VAT rates/exemption categories), a discrepancy/anomaly flagging report, and — critically — this should be a **review-and-flag tool, never an auto-submit tool**. Nothing here should file anything with ZATCA directly; it should produce a pre-submission audit report for a human to act on. This is a hard scope boundary given the compliance/financial stakes.
**Open questions:** which accounting/ERP system Allure uses and whether Composio has a toolkit for it; whether Allure already has ZATCA e-invoicing (Fatoora) integration this tool reads from, or whether invoice ingestion has to come from the ERP directly; this is the single highest-liability use case in the list and should get a dedicated scoping conversation with whoever owns Allure's finance/compliance function before any code, independent of the rest of this plan.

## Phase 2 — P2 use cases (build after Phase 1 lands)

### #5 Employee AI Copilot
Straightforward reuse of the existing Knowledge Base + agent chat interface, scoped to internal-only content (SOPs, HR policies, protocols, orientation material). Lowest-risk, fastest to ship of all ten — could realistically move earlier if the user wants a quick win, since it needs almost no new infra, just content ingestion into Knowledge Base and an agent persona.

### #7 Management AI Copilot & KPI Intelligence
Reuses Analytics (time-range + per-agent breakdown, already built this session) as the data layer, the Meeting Assistant for auto-generated minutes-of-meeting with follow-up reminders (already fully built — this is a direct reuse, not new work), and adds natural-language querying over the KPI data plus anomaly detection/forecasting as new analysis tools.
**Data needs:** depends on #1, #2, #4 (Quality, Revenue, Patient 360) being live to have real KPIs to report on.

### #9 Inventory & Procurement AI
**New infra**, no close existing analog in the platform. Needs stock-level and purchasing-history data from wherever Allure tracks inventory (likely the same ERP/accounting system as #8, or a separate inventory system — open question), plus Patient 360's upcoming-appointment/treatment-mix data for consumption forecasting.

### #10 AI Financial Controller & Internal Auditor
Builds directly on #8's transaction-ingestion pipeline — this is the broader "watch all financial transactions for anomalies" version of what #8 does specifically for VAT. Should share the ingestion/classification infra with #8 rather than duplicating it. Same hard scope boundary as #8: flags and reports, never auto-acts on financial data.

## What this plan deliberately does NOT assume

- Which CRM, telephony/voice system, WhatsApp Business account, accounting/ERP system, or inventory system Allure actually runs — every use case above that needs one is marked as an open question, not a guessed integration.
- Whether Composio has ready-made toolkits for Allure's specific systems — needs a real toolkit search once the systems are named, not assumed.
- ML/predictive components (revenue-opportunity scoring, anomaly detection, forecasting) — v1 of every use case above is rules/threshold-based on real data; a learned-model layer is a later iteration once there's enough real usage data to train on, not a day-one requirement.

## Recommended starting slice

**Phase 0 (Patient 360 data model) + #5 (Employee Copilot).** Patient 360 unblocks the largest number of downstream use cases and has zero external-integration dependency to start. Employee Copilot is near-zero new infra and gives a fast, visible win while Patient 360 is being built, without competing for the same engineering attention (Copilot is Knowledge Base content work; Patient 360 is data-model/store work).

**Immediately after:** #8 (VAT/ZATCA) should get its own scoping conversation in parallel, given it's the highest-liability item and needs Allure's finance-side input before any design decision, not just engineering decisions.

## Open questions requiring answers from Allure Clinics before Phase 1 can fully start

1. CRM system in use (for Composio toolkit lookup / patient data backfill)
2. Telephony/voice provider (for Contact Center's voice channel)
3. WhatsApp Business API account ownership
4. Accounting/ERP system (for VAT/ZATCA and Financial Controller)
5. Existing ZATCA e-invoicing (Fatoora) integration, if any
6. Inventory tracking system, if separate from the ERP
7. Multi-branch/multi-clinic structure (affects whether `agent/tenancy/`'s org model maps directly or needs a "location" sub-scope)
