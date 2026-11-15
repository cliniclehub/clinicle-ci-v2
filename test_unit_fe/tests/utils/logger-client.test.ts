import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("logger-client", () => {
  const consoleSpies = {
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    groupCollapsed: vi.spyOn(console, "groupCollapsed").mockImplementation(() => {}),
    groupEnd: vi.spyOn(console, "groupEnd").mockImplementation(() => {}),
  }

  beforeEach(() => {
    Object.values(consoleSpies).forEach((spy) => spy.mockClear())
  })

  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it("logs human-readable messages with data and errors", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "DEBUG")
    vi.stubEnv("NEXT_PUBLIC_LOG_JSON", "false")
    vi.resetModules()
    const { createClientLogger } = await import("@/lib/utils/logger-client")
    const logger = createClientLogger("TestClass").forMethod("doThing")

    logger.debug("dbg", { a: 1 })
    logger.info("inf")
    logger.warn("wrn")
    logger.error("err", new Error("boom"), { x: 1 })
    logger.fatal("ftl", new Error("fatal"))

    expect(consoleSpies.groupCollapsed).toHaveBeenCalled()
    expect(consoleSpies.groupEnd).toHaveBeenCalled()
    expect(consoleSpies.log).toHaveBeenCalledWith("📦 Data:", { a: 1 })
    expect(consoleSpies.error).toHaveBeenCalledWith("❌ Error:", "boom")
  })

  it("logs JSON when NEXT_PUBLIC_LOG_JSON is true", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "INFO")
    vi.stubEnv("NEXT_PUBLIC_LOG_JSON", "true")
    vi.resetModules()
    const { createClientLogger, LogLevel } = await import("@/lib/utils/logger-client")
    expect(LogLevel.ERROR).toBe(3)

    const logger = createClientLogger("JsonLogger")
    logger.debug("hidden")
    logger.info("visible", { ok: true })
    logger.warn("warn-json")
    logger.error("err-json", new Error("e"))
    logger.fatal("fatal-json")

    expect(consoleSpies.debug).not.toHaveBeenCalled()
    expect(consoleSpies.info).toHaveBeenCalled()
    const json = String(consoleSpies.info.mock.calls[0]?.[0])
    expect(json).toContain('"message":"visible"')
    expect(json).toContain('"logger":"JsonLogger"')
    expect(consoleSpies.warn).toHaveBeenCalled()
    expect(consoleSpies.error).toHaveBeenCalled()
  })

  it("stringifies circular data and DOM-like nodes safely in JSON mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "DEBUG")
    vi.stubEnv("NEXT_PUBLIC_LOG_JSON", "true")
    vi.resetModules()
    const { createClientLogger } = await import("@/lib/utils/logger-client")
    const logger = createClientLogger("Circ")
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(() => logger.info("circ", circular)).not.toThrow()
    const json = String(consoleSpies.info.mock.calls[0]?.[0])
    expect(json).toContain("[Circular]")

    const el = document.createElement("div")
    logger.info("dom", el)
    const domJson = String(consoleSpies.info.mock.calls.at(-1)?.[0])
    expect(domJson).toContain("[DOM: DIV]")
  })

  it("defaults unknown log levels to DEBUG", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "NOPE")
    vi.stubEnv("NEXT_PUBLIC_LOG_JSON", "true")
    vi.resetModules()
    const { createClientLogger } = await import("@/lib/utils/logger-client")
    const logger = createClientLogger("DefaultLevel")
    logger.debug("ok")
    expect(consoleSpies.debug).toHaveBeenCalled()
  })
})
