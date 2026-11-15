import { describe, expect, it } from "vitest"

import {
  getDomainClient,
  getFullDomainClient,
  isSignupDisabled,
} from "@/lib/utils/domain-name-helper-client"

describe("domain-name-helper-client", () => {
  it("reads hostname/host and leaves tenant signup enabled", () => {
    expect(getDomainClient()).toBe(window.location.hostname)
    expect(getFullDomainClient()).toBe(window.location.host)
    expect(isSignupDisabled()).toBe(false)
  })
})
