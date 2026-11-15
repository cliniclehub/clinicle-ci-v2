# Frontend unit tests (`test_unit_fe/`)

Vitest suite for frontend business logic and components in `fe/`. Mirrors the backend layout: tests live outside the app tree; source is imported via the `@/*` alias (same as Next.js).

## Run

From repo root:

```bash
make test-unit-fe-setup         # install Vitest tooling
make test-unit-fe          # run once
make test-unit-fe-cov      # coverage gate: fe/lib/utils only
make test-unit-fe-cov-broad  # optional: utils + all components (diluted)
```

From `fe/`:

```bash
npm run test
npm run test:watch
npm run test:cov
npm run test:cov:broad
```

Dependencies are installed in `fe/node_modules` (see `fe/package.json`). Vitest config lives in `fe/vitest.config.ts`; tests live here under `tests/`.

## Coverage targets (leadership)

| Metric | Surface | Now | Target | Max practical |
|--------|---------|-----|--------|---------------|
| FE unit gate | `fe/lib/utils/**` | ~27% | **80%** (stretch **85%**) | **~85–90%** |
| Components | RTL presentational only | ~3.5% of all components | no whole-folder % gate | curated allowlist later |
| Pages (`fe/app`) | — | — | Playwright / manual | not a Vitest % |

Pages and checkout shells are proven with Playwright (`test_st_ui`) or manual ST — not Vitest line %. Details: `.cursor/plans/frontend-unit-coverage-targets.md`.

## Layout

```
test_unit_fe/
├── vitest.setup.ts          # legacy; active setup is fe/vitest.setup.ts
└── tests/
    ├── lib/utils/           # phase 1 — pure utils
    └── components/          # phase 2 — RTL component tests

fe/
├── vitest.config.ts
├── vitest.setup.ts          # @testing-library/jest-dom
└── test-utils/render.tsx    # shared RTL render helper
```

Add utils tests at `tests/<path>/<module>.test.ts` for `fe/<path>/<module>.ts`.  
Add component tests at `tests/components/<area>/<component>.test.tsx`.

## Conventions

### Phase 1 — pure utils

- No Next.js server actions, no `"use client"` components.
- Fixed clocks — pass `now` into date helpers or use `vi.setSystemTime()`.
- Naming — `*.test.ts`.

### Phase 2 — React Testing Library

- Import `render`, `screen`, `userEvent` from `@/test-utils/render`.
- Prefer presentational components with minimal deps first.
- Mock hooks/server actions at the top of the test file, e.g.:

```tsx
vi.mock("@/lib/hooks/use-aid-program-label", () => ({
  useAidProgramLabel: () => "Aid",
}))
```

- Use `aidLabel` prop when a component exposes it (avoids hook mocks).
- Component tests use `*.test.tsx`.

## Current suite size

| Phase | Scope | Approx. |
|-------|--------|---------|
| 1 | `fe/lib/utils/` | ~47 test files |
| 2 | `fe/components/` (presentational) | ~25 test files |

Run coverage: `make test-unit-fe-cov` → `test_unit_fe/coverage/` (utils gate).

## Phase 2 next targets

- More enrollment/catalog badges and table cells (RTL; does not drive the % gate)
- Money-path utils still at 0–40% (drives the utils %)
- Components with `next/navigation` — mock `useRouter` / `usePathname`
- Shared providers in `fe/test-utils/render.tsx` (theme, toasts) as needed
