import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

import { mockRouterPush } from "@/test-utils/mock-next-navigation"

afterEach(() => {
  cleanup()
  mockRouterPush.mockClear()
})
