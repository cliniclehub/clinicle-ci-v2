import { describe, expect, it } from "vitest"

import {
  isHttpOkErrorEnvelope,
  parseHttpOkErrorEnvelope,
  pickErrorDetails,
} from "@/lib/utils/api-response-envelope"

describe("api-response-envelope", () => {
  const getErrorType = (status: number) => `Http${status}`

  it("detects success:false and status:error envelopes", () => {
    expect(isHttpOkErrorEnvelope({ success: false, message: "nope" })).toBe(true)
    expect(isHttpOkErrorEnvelope({ status: "error", message: "nope" })).toBe(true)
    expect(isHttpOkErrorEnvelope({ status: "success", data: {} })).toBe(false)
    expect(isHttpOkErrorEnvelope({ success: true, data: {} })).toBe(false)
  })

  it("parses HTTP 200 error envelopes as ApiResponse errors", () => {
    const result = parseHttpOkErrorEnvelope(
      {
        success: false,
        message: "Checkout quote expired",
        code: 409,
        type: "QuoteExpired",
        description: "expired",
        details: { reason: "ttl" },
      },
      200,
      getErrorType
    )

    expect(result.status).toBe("error")
    expect(result.code).toBe(409)
    expect(result.type).toBe("QuoteExpired")
    expect(result.message).toBe("Checkout quote expired")
    expect(result.description).toBe("expired")
    expect(result.details).toEqual({ reason: "ttl" })
  })

  it("falls back to HTTP status when envelope code is missing", () => {
    const result = parseHttpOkErrorEnvelope(
      { status: "error", detail: "Validation failed" },
      200,
      getErrorType
    )

    expect(result.status).toBe("error")
    expect(result.code).toBe(200)
    expect(result.message).toBe("Validation failed")
    expect(result.type).toBe("Http200")
  })

  it("picks details or detail objects", () => {
    expect(pickErrorDetails({ details: { a: 1 } })).toEqual({ a: 1 })
    expect(pickErrorDetails({ detail: { b: 2 } })).toEqual({ b: 2 })
    expect(pickErrorDetails({ detail: "string" })).toBeUndefined()
  })
})
