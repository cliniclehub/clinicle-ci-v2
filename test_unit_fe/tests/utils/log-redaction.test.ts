import { describe, expect, it } from "vitest"

import {
  redactForLog,
  redactHeaderValue,
  redactHeadersForLog,
  redactUrlForLog,
} from "@/lib/utils/log-redaction"

describe("log-redaction", () => {
  it("redacts sensitive query params and payload keys", () => {
    const url = redactUrlForLog("https://example.com/x?token=secret&ok=1")
    expect(url).toContain("token=%5BREDACTED%5D")
    expect(url).toContain("ok=1")
    expect(redactForLog({ password: "x", nested: { access_token: "y" }, keep: 1 })).toEqual({
      password: "[REDACTED]",
      nested: { access_token: "[REDACTED]" },
      keep: 1,
    })
  })

  it("redacts sensitive headers", () => {
    expect(redactHeaderValue("Authorization", "Bearer x")).toBe("[REDACTED]")
    expect(redactHeaderValue("x-request-id", "abc")).toBe("abc")
    expect(redactHeadersForLog({ Cookie: "a=b", Accept: "json" })).toEqual({
      Cookie: "[REDACTED]",
      Accept: "json",
    })
  })
})
