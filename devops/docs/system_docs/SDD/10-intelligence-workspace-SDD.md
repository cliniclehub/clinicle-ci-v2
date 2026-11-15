# Intelligence Workspace — Software Design Document

Status: placeholder shell  
Last updated: 2026-09-30  
Business requirements: [`10-intelligence-workspace-BRD.md`](../BRD/10-intelligence-workspace-BRD.md)  
UI system tests: [`10-intelligence-workspace-ST-UI.md`](../ST-UI/10-intelligence-workspace-ST-UI.md)

## Architecture and boundaries

```text
FE (intelligence) routes → IntelligencePlaceholderPage
  → (future) /api/v1/<intelligence-services>
```

No backend package under `be/app/v1/` for intelligence yet.

## Requirement-to-component map

| BRD ID | Components | Status |
|---|---|---|
| INT-01 | `fe/app/(main)/(intelligence)/*` | Placeholder implemented |
| INT-02 | no BE calls from placeholders | Implemented |

## Known implementation gaps

- All domain behavior pending product/engineering delivery.

---

## Unit test plan and coverage

No backend unit suite. Optional FE smoke that placeholder titles render.
