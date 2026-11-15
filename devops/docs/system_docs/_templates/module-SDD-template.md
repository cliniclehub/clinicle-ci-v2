# [Module Name] — Software Design Document

Status: draft  
Last updated: YYYY-MM-DD  
Business requirements: [`NN-module-slug-BRD.md`](../BRD/NN-module-slug-BRD.md)  
UI system tests: [`NN-module-slug-ST-UI.md`](../ST-UI/NN-module-slug-ST-UI.md)

## Purpose

## Architecture and boundaries

## Requirement-to-component map

| BRD ID | Implementation components | Status/gap |
|---|---|---|

## Data model

## API contracts

## Frontend implementation

## Authorization and tenant isolation

## State transitions and workflows

## Integrations and side effects

## Error handling, idempotency, and recovery

## Security and privacy considerations

## Observability and operations

## Analytics impact and contracts

Document the module-owned authoritative facts, event contracts and versions,
source/reliability class, historical dimensions and snapshots, deterministic
idempotency, delivery/reconciliation/backfill path, tenant/resource isolation,
consent/privacy/retention controls, metric dependencies, and data-quality
monitoring. If the BRD states `No analytics impact`, verify the design does not
introduce an unreviewed fact or interaction.

## Known implementation gaps

---

## Unit test plan and coverage

Developer-owned backend unit/service/schema and frontend utility/component
coverage (`test_unit_be` / `test_unit_fe`).

### Requirement coverage

| BRD ID | Developer-owned unit coverage | Status |
|---|---|---|

### Backend unit and service coverage

### Frontend unit and component coverage

### Analytics contract coverage

### Recommended missing tests

### Focused commands

### Execution history

### Known unit-test gaps
