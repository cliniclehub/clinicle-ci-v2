import { afterEach, describe, expect, it } from "vitest"

import {
  MAX_RELOADS_PER_BUILD,
  RELOAD_COOLDOWN_MS,
  RELOAD_GUARD_KEY,
  buildDeploymentSkewInlineScript,
  getCurrentBuildId,
  isLikelyServerActionFetch,
  messageLooksLikeChunkLoadFailure,
  messageLooksLikeServerActionDeploymentSkew,
  recordDeploymentReloadAttempt,
  shouldAllowDeploymentReload,
} from "@/lib/utils/deployment-skew-guard"

describe("deployment-skew-guard", () => {
  afterEach(() => {
    sessionStorage.removeItem(RELOAD_GUARD_KEY)
  })

  it("detects skew and chunk messages", () => {
    expect(
      messageLooksLikeServerActionDeploymentSkew("Failed to find Server Action")
    ).toBe(true)
    expect(
      messageLooksLikeServerActionDeploymentSkew(
        "This request might be from an older or newer deployment"
      )
    ).toBe(true)
    expect(messageLooksLikeChunkLoadFailure("Loading chunk 12 failed")).toBe(true)
    expect(messageLooksLikeChunkLoadFailure("ChunkLoadError")).toBe(true)
    expect(
      messageLooksLikeChunkLoadFailure("Failed to fetch dynamically imported module")
    ).toBe(true)
    expect(isLikelyServerActionFetch("https://x", { headers: { "Next-Action": "abc" } })).toBe(
      true
    )
    expect(isLikelyServerActionFetch("https://x", { headers: { "next-action": "abc" } })).toBe(
      true
    )
    expect(isLikelyServerActionFetch("https://x")).toBe(false)
    expect(buildDeploymentSkewInlineScript("build-1")).toContain("build-1")
    expect(getCurrentBuildId()).toBeTruthy()
    expect(MAX_RELOADS_PER_BUILD).toBe(1)
    expect(RELOAD_COOLDOWN_MS).toBe(60_000)
  })

  it("guards reload attempts in sessionStorage", () => {
    expect(shouldAllowDeploymentReload()).toBe(true)
    recordDeploymentReloadAttempt()
    expect(shouldAllowDeploymentReload()).toBe(false)

    sessionStorage.setItem(RELOAD_GUARD_KEY, "1")
    expect(shouldAllowDeploymentReload()).toBe(false)

    sessionStorage.setItem(RELOAD_GUARD_KEY, "{bad")
    expect(shouldAllowDeploymentReload()).toBe(false)

    sessionStorage.setItem(
      RELOAD_GUARD_KEY,
      JSON.stringify({ build: "other-build", at: Date.now() - RELOAD_COOLDOWN_MS - 1, count: 1 })
    )
    expect(shouldAllowDeploymentReload()).toBe(true)
  })
})
