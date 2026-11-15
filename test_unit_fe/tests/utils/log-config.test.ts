import { afterEach, describe, expect, it } from "vitest"

import {
  getLogHttpBodies,
  getLogHttpHeaders,
  getLoggingEnvironment,
  getServerLogLevel,
  isLocalLoggingEnvironment,
  shouldLogHttpExchange,
} from "@/lib/utils/log-config"

describe("log-config", () => {
  const keys = ["ENVIRONMENT", "NODE_ENV", "LOG_LEVEL", "LOG_HTTP_HEADERS", "LOG_HTTP_BODIES"]
  const backup = Object.fromEntries(keys.map((k) => [k, process.env[k]]))

  afterEach(() => {
    for (const k of keys) {
      if (backup[k] === undefined) delete process.env[k]
      else process.env[k] = backup[k]
    }
  })

  it("defaults local verbose and non-local quiet", () => {
    delete process.env.ENVIRONMENT
    process.env.NODE_ENV = "production"
    delete process.env.LOG_LEVEL
    delete process.env.LOG_HTTP_HEADERS
    delete process.env.LOG_HTTP_BODIES
    expect(getLoggingEnvironment()).toBe("production")
    expect(isLocalLoggingEnvironment()).toBe(false)
    expect(getServerLogLevel()).toBe("INFO")
    expect(getLogHttpHeaders()).toBe(false)
    expect(getLogHttpBodies()).toBe(false)
    expect(shouldLogHttpExchange()).toBe(false)

    process.env.ENVIRONMENT = "local"
    expect(isLocalLoggingEnvironment()).toBe(true)
    expect(getServerLogLevel()).toBe("DEBUG")
    expect(getLogHttpHeaders()).toBe(true)
    expect(shouldLogHttpExchange()).toBe(true)

    process.env.LOG_HTTP_HEADERS = "false"
    process.env.LOG_HTTP_BODIES = "true"
    expect(getLogHttpHeaders()).toBe(false)
    expect(getLogHttpBodies()).toBe(true)
    expect(shouldLogHttpExchange()).toBe(true)
  })
})
