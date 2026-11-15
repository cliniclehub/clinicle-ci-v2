import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  isProtectedMiddlewareRoute,
  isPublicMiddlewareRoute,
  middlewareRequiresAuth,
  pageFilePathToRoutePath,
} from "@/lib/utils/middleware-route-policy"

const feRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fe")

function listMainAppPageFiles(): string[] {
  const mainRoot = path.join(feRoot, "app/(main)")
  const results: string[] = []

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name === "page.tsx") {
        results.push(path.relative(feRoot, fullPath).split(path.sep).join("/"))
      }
    }
  }

  walk(mainRoot)
  return results.sort()
}

describe("middleware route coverage", () => {
  it("maps app/(main) page files to URL paths", () => {
    expect(pageFilePathToRoutePath("app/(main)/(dashboards)/dashboard/page.tsx")).toBe(
      "/dashboard"
    )
    expect(
      pageFilePathToRoutePath(
        "app/(main)/organization-users/edit/[userId]/page.tsx"
      )
    ).toBe("/organization-users/edit/[userId]")
  })

  it("requires auth for every live app/(main) route", () => {
    const pageFiles = listMainAppPageFiles()
    expect(pageFiles).toContain("app/(main)/(dashboards)/dashboard/page.tsx")

    const unprotected: string[] = []
    for (const pageFile of pageFiles) {
      const routePath = pageFilePathToRoutePath(pageFile)
      if (isPublicMiddlewareRoute(routePath)) {
        continue
      }
      if (!middlewareRequiresAuth(routePath)) {
        unprotected.push(routePath)
      }
    }

    expect(unprotected, `Missing PROTECTED_ROUTE_PREFIXES for: ${unprotected.join(", ")}`).toEqual(
      []
    )
  })

  it("keeps public legal pages public and organization administration protected", () => {
    expect(isPublicMiddlewareRoute("/privacy-policy")).toBe(true)
    expect(isProtectedMiddlewareRoute("/privacy-policy")).toBe(false)
    expect(middlewareRequiresAuth("/organization-users")).toBe(true)
  })

  it("does not treat /chat-with-us as the intelligence /chat route", () => {
    expect(middlewareRequiresAuth("/chat")).toBe(true)
    expect(middlewareRequiresAuth("/chat-with-us")).toBe(true)
    expect(pageFilePathToRoutePath("app/(main)/(intelligence)/chat/page.tsx")).toBe("/chat")
  })
})
