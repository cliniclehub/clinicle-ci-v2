import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const feRoot = path.dirname(fileURLToPath(import.meta.url))
const feUnitTestRoot = path.resolve(feRoot, "../test_unit_fe")

/** Include large client/server I/O helpers in the % denominator when set. */
const includeComponents = process.env.FE_COV_INCLUDE_COMPONENTS === "1"

/**
 * Leadership unit-coverage gate is `lib/utils` only.
 * Pages (`app/`) and most interactive components belong to Playwright / manual.
 * Set FE_COV_INCLUDE_COMPONENTS=1 for a broader (diluted) report.
 */
const coverageInclude = includeComponents
  ? ["lib/utils/**/*.ts", "components/**/*.tsx"]
  : ["lib/utils/**/*.ts"]

export default defineConfig({
  plugins: [react()],
  root: feRoot,
  server: {
    fs: {
      allow: [feRoot, feUnitTestRoot],
    },
  },
  resolve: {
    alias: {
      "@": feRoot,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [
      path.join(feRoot, "test-utils/mock-next-navigation.ts"),
      path.join(feRoot, "vitest.setup.ts"),
    ],
    include: [
      path.join(feUnitTestRoot, "tests/**/*.test.ts"),
      path.join(feUnitTestRoot, "tests/**/*.test.tsx"),
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: path.join(feUnitTestRoot, "coverage"),
      reporter: ["text", "html", "json-summary"],
      include: coverageInclude,
      // Visual watermarks only (no fail gate yet). Utils target: 80% / stretch 85–90%.
      watermarks: {
        lines: [50, 80],
        statements: [50, 80],
        functions: [50, 80],
        branches: [40, 70],
      },
    },
  },
})
