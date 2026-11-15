import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `getDomain()` depends on Next request-scoped `headers()` and cannot be
 * reliably mocked under Vitest for this `use server` module. Cover pure helpers.
 */
import {
  cleanDomain,
  extractSubdomain,
  isLocalhost,
} from "@/lib/utils/domain-name-helper-server"

describe("domain-name-helper-server", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  it("cleans domains and extracts subdomains", async () => {
    expect(await cleanDomain("")).toBe("")
    expect(await cleanDomain("https://learn.suhba.com:3000/path")).toBe("learn.suhba.com")
    expect(await cleanDomain("http://learn.suhba.com:3000")).toBe("learn.suhba.com")
    expect(await cleanDomain("learn.suhba.com:3000")).toBe("learn.suhba.com")
    expect(await cleanDomain("learn.suhba.com")).toBe("learn.suhba.com")
    expect(await extractSubdomain("learn.suhba.com")).toBe("learn")
    expect(await extractSubdomain("www.example.com")).toBe("www")
    expect(await extractSubdomain("suhba.com")).toBeNull()
    expect(await extractSubdomain("")).toBeNull()
    expect(await isLocalhost("localhost:3000")).toBe(true)
    expect(await isLocalhost("app.localhost")).toBe(true)
    expect(await isLocalhost("127.0.0.1")).toBe(true)
    expect(await isLocalhost("learn.example.com")).toBe(false)
  })

  it("falls back when URL constructor fails", async () => {
    const cleaned = await cleanDomain("http://%")
    expect(cleaned.length).toBeGreaterThan(0)
  })
})
