import { afterEach, describe, expect, it } from "vitest"

import {
  getLogHttpBodies,
  getLogHttpHeaders,
  getServerLogLevel,
  isLocalLoggingEnvironment,
} from "@/lib/utils/log-config"
import {
  redactForLog,
  redactHeaderValue,
  redactUrlForLog,
} from "@/lib/utils/log-redaction"

describe("log-config", () => {
  const originals = {
    ENVIRONMENT: process.env.ENVIRONMENT,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_HTTP_HEADERS: process.env.LOG_HTTP_HEADERS,
    LOG_HTTP_BODIES: process.env.LOG_HTTP_BODIES,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it("defaults HTTP logging on in local", () => {
    process.env.ENVIRONMENT = "local"
    delete process.env.LOG_HTTP_HEADERS
    delete process.env.LOG_HTTP_BODIES
    expect(isLocalLoggingEnvironment()).toBe(true)
    expect(getLogHttpHeaders()).toBe(true)
    expect(getLogHttpBodies()).toBe(true)
    expect(getServerLogLevel()).toBe("DEBUG")
  })

  it("defaults HTTP logging off outside local", () => {
    process.env.ENVIRONMENT = "production"
    delete process.env.LOG_LEVEL
    delete process.env.LOG_HTTP_HEADERS
    delete process.env.LOG_HTTP_BODIES
    expect(isLocalLoggingEnvironment()).toBe(false)
    expect(getLogHttpHeaders()).toBe(false)
    expect(getLogHttpBodies()).toBe(false)
    expect(getServerLogLevel()).toBe("INFO")
  })

  it("respects explicit break-glass HTTP flags", () => {
    process.env.ENVIRONMENT = "production"
    process.env.LOG_HTTP_HEADERS = "true"
    process.env.LOG_HTTP_BODIES = "true"
    process.env.LOG_LEVEL = "DEBUG"
    expect(getLogHttpHeaders()).toBe(true)
    expect(getLogHttpBodies()).toBe(true)
    expect(getServerLogLevel()).toBe("DEBUG")
  })
})

describe("log-redaction", () => {
  it("redacts sensitive payload keys and signed URL query params", () => {
    const redacted = redactForLog({
      email: "a@example.com",
      password: "secret",
      tokens: { accessToken: "jwt-here", refreshToken: "refresh" },
      client_secret: "pi_secret",
      code: "123456",
      playbackUrl: "https://cdn.example.com/x?mediaToken=abc&expires=1",
      title: "ok",
    }) as Record<string, unknown>

    expect(redacted.email).toBe("a@example.com")
    expect(redacted.password).toBe("[REDACTED]")
    // Parent key contains "token" → whole branch redacted
    expect(redacted.tokens).toBe("[REDACTED]")
    expect(redacted.client_secret).toBe("[REDACTED]")
    expect(redacted.code).toBe("[REDACTED]")
    expect(redacted.playbackUrl).toBe("[REDACTED]")
    expect(redacted.title).toBe("ok")
  })

  it("fully redacts auth headers", () => {
    expect(redactHeaderValue("Authorization", "Bearer abc.def")).toBe("[REDACTED]")
    expect(redactHeaderValue("Session-Token", "exam")).toBe("[REDACTED]")
    expect(redactHeaderValue("Content-Type", "application/json")).toBe(
      "application/json"
    )
  })

  it("scrubs sensitive query params from URLs", () => {
    const out = redactUrlForLog(
      "https://media.example.com/orgs/1/a.mp4?token=secret&local=1"
    )
    expect(out).toContain("orgs/1/a.mp4")
    expect(out).not.toContain("secret")
    expect(out).toMatch(/REDACTED/)
  })
})
